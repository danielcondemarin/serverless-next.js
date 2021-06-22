// @ts-ignore
import PrerenderManifest from "./prerender-manifest.json";
// @ts-ignore
import Manifest from "./manifest.json";
// @ts-ignore
import RoutesManifestJson from "./routes-manifest.json";
import lambdaAtEdgeCompat from "@sls-next/next-aws-cloudfront";
import {
  Event,
  ExternalRoute,
  Fallback,
  handleDefault,
  PublicFileRoute,
  getCustomHeaders,
  StaticRoute,
  getStaticRegenerationResponse,
  getThrottledStaticRegenerationCachePolicy,
  setCustomHeaders
} from "@sls-next/core";

import {
  CloudFrontRequest,
  CloudFrontResultResponse,
  CloudFrontS3Origin
} from "aws-lambda";
import {
  OriginRequestDefaultHandlerManifest,
  OriginRequestEvent,
  PerfLogger,
  PreRenderedManifest as PrerenderManifestType,
  RoutesManifest
} from "./types";
import { performance } from "perf_hooks";
import { externalRewrite } from "./routing/rewriter";
import { removeBlacklistedHeaders } from "./headers/removeBlacklistedHeaders";
import { s3BucketNameFromEventRequest } from "./s3/s3BucketNameFromEventRequest";
import { triggerStaticRegeneration } from "./lib/triggerStaticRegeneration";
import { s3GetPage } from "./s3/s3GetPage";
import { s3StorePage } from "./s3/s3StorePage";

const basePath = RoutesManifestJson.basePath;

const perfLogger = (logLambdaExecutionTimes?: boolean): PerfLogger => {
  if (logLambdaExecutionTimes) {
    return {
      now: () => performance.now(),
      log: (metricDescription: string, t1?: number, t2?: number): void => {
        if (!t1 || !t2) return;
        console.log(`${metricDescription}: ${t2 - t1} (ms)`);
      }
    };
  }
  return {
    now: () => 0,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    log: () => {}
  };
};

const addS3HostHeader = (
  req: CloudFrontRequest,
  s3DomainName: string
): void => {
  req.headers["host"] = [{ key: "host", value: s3DomainName }];
};

const normaliseS3OriginDomain = (s3Origin: CloudFrontS3Origin): string => {
  if (s3Origin.region === "us-east-1") {
    return s3Origin.domainName;
  }

  if (!s3Origin.domainName.includes(s3Origin.region)) {
    const regionalEndpoint = s3Origin.domainName.replace(
      "s3.amazonaws.com",
      `s3.${s3Origin.region}.amazonaws.com`
    );
    return regionalEndpoint;
  }

  return s3Origin.domainName;
};

export const handler = async (
  event: OriginRequestEvent
): Promise<CloudFrontResultResponse | CloudFrontRequest> => {
  const manifest: OriginRequestDefaultHandlerManifest = Manifest;
  const prerenderManifest: PrerenderManifestType = PrerenderManifest;
  const routesManifest: RoutesManifest = RoutesManifestJson;

  const { now, log } = perfLogger(manifest.logLambdaExecutionTimes);

  const tHandlerBegin = now();

  const response = await handleOriginRequest({
    event,
    manifest,
    prerenderManifest,
    routesManifest
  });

  // Remove blacklisted headers
  if (response.headers) {
    removeBlacklistedHeaders(response.headers);
  }

  const tHandlerEnd = now();

  log("handler execution time", tHandlerBegin, tHandlerEnd);

  return response;
};

const staticRequest = (
  request: CloudFrontRequest,
  file: string,
  path: string
) => {
  const s3Origin = request.origin?.s3 as CloudFrontS3Origin;
  const s3Domain = normaliseS3OriginDomain(s3Origin);
  s3Origin.domainName = s3Domain;
  s3Origin.path = path;
  request.uri = file;
  addS3HostHeader(request, s3Domain);
  return request;
};

const getS3File = (
  request: CloudFrontRequest,
  buildId: string,
  bucketName?: string,
  region?: string
) => {
  return async (
    event: Event,
    route: PublicFileRoute | StaticRoute
  ): Promise<boolean> => {
    const { isData, isPublicFile, file, page, revalidate, statusCode } =
      route.isStatic
        ? (route as StaticRoute)
        : {
            ...route,
            isData: undefined,
            revalidate: undefined,
            page: undefined
          };
    const s3Page = await s3GetPage({
      basePath,
      bucketName,
      buildId,
      file,
      isData,
      isPublicFile,
      region
    });

    if (!s3Page) {
      return false;
    }

    const { req, res } = event;
    const is404 = statusCode === 404;
    const is500 = statusCode === 500;
    res.statusCode = statusCode || 200;
    res.statusMessage = is500
      ? "Internal Server Error"
      : is404
      ? "Not Found"
      : "OK";

    const contentTypeFallback = isData ? "application/json" : "text/html";
    res.setHeader("Content-Type", s3Page.contentType || contentTypeFallback);

    setCustomHeaders(event, RoutesManifestJson);

    const isrResponse = getStaticRegenerationResponse({
      expires: s3Page.expires,
      lastModified: s3Page.lastModified,
      initialRevalidateSeconds: revalidate
    });

    if (is500) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=0, s-maxage=0, must-revalidate"
      );
    } else if (isrResponse) {
      res.setHeader("Cache-Control", isrResponse.cacheControl);

      if (page && isrResponse.secondsRemainingUntilRevalidation <= 0) {
        const { throttle } = await triggerStaticRegeneration({
          basePath,
          pagePath: page,
          request,
          etag: s3Page.etag,
          lastModified: s3Page.lastModified
        });

        // Occasionally we will get rate-limited by the Queue (in the event we
        // send it too many messages) and so we we use the cache to reduce
        // requests to the queue for a short period.
        if (throttle) {
          res.setHeader(
            "Cache-Control",
            getThrottledStaticRegenerationCachePolicy(1).cacheControl
          );
        }
      }
    } else {
      const isFallback = (req.url ?? "").includes("[");
      res.setHeader(
        "Cache-Control",
        s3Page.cacheControl ??
          (isFallback
            ? "public, max-age=0, s-maxage=0, must-revalidate"
            : "public, max-age=0, s-maxage=2678400, must-revalidate")
      );
    }

    res.end(s3Page.bodyString);
    return true;
  };
};

const putS3Files = (buildId: string, bucketName?: string, region?: string) => {
  return async (event: Event, fallback: Fallback): Promise<void> => {
    const { renderOpts, html } = fallback;
    const { expires } = await s3StorePage({
      html,
      uri: fallback.route.file.slice("pages".length),
      basePath,
      bucketName: bucketName || "",
      buildId: buildId,
      pageData: renderOpts.pageData,
      region: region || "",
      revalidate: renderOpts.revalidate
    });

    const isrResponse = expires
      ? getStaticRegenerationResponse({ expires })
      : null;

    const cacheControl =
      (isrResponse && isrResponse.cacheControl) ||
      "public, max-age=0, s-maxage=2678400, must-revalidate";

    const { res } = event;
    res.statusCode = 200;
    res.statusMessage = "OK";
    res.setHeader("Cache-Control", cacheControl);

    if (fallback.route.isData) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(renderOpts.pageData));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    }
  };
};

const handleOriginRequest = async ({
  event,
  manifest,
  prerenderManifest,
  routesManifest
}: {
  event: OriginRequestEvent;
  manifest: OriginRequestDefaultHandlerManifest;
  prerenderManifest: PrerenderManifestType;
  routesManifest: RoutesManifest;
}) => {
  const request = event.Records[0].cf.request;
  const { req, res, responsePromise } = lambdaAtEdgeCompat(
    event.Records[0].cf,
    {
      enableHTTPCompression: manifest.enableHTTPCompression
    }
  );

  const { now, log } = perfLogger(manifest.logLambdaExecutionTimes);

  let tBeforeSSR = null;
  const getPage = (pagePath: string) => {
    const tBeforePageRequire = now();
    const page = require(`./${pagePath}`); // eslint-disable-line
    const tAfterPageRequire = (tBeforeSSR = now());
    log("require JS execution time", tBeforePageRequire, tAfterPageRequire);
    return page;
  };

  const getFile = getS3File(
    request,
    manifest.buildId,
    s3BucketNameFromEventRequest(request),
    request.origin?.s3?.region
  );

  const putFiles = putS3Files(
    manifest.buildId,
    s3BucketNameFromEventRequest(request),
    request.origin?.s3?.region
  );

  const route = await handleDefault(
    { req, res, responsePromise },
    manifest,
    prerenderManifest,
    routesManifest,
    { getFile, getPage, putFiles }
  );
  if (tBeforeSSR) {
    const tAfterSSR = now();
    log("SSR execution time", tBeforeSSR, tAfterSSR);
  }

  if (!route) {
    return await responsePromise;
  }

  if (route.isPublicFile) {
    const { file } = route as PublicFileRoute;
    const customHeaders = getCustomHeaders(request.uri, routesManifest);
    if (Object.keys(customHeaders).length) {
      // Get using S3 client, to set custom headers
      if (await getFile({ req, res, responsePromise }, route as StaticRoute)) {
        return await responsePromise;
      }
    }
    return staticRequest(request, file, `${routesManifest.basePath}/public`);
  }

  const external: ExternalRoute = route;
  return externalRewrite(event, manifest.enableHTTPCompression, external.path);
};
