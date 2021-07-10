// @ts-ignore
import PrerenderManifest from "./prerender-manifest.json";
// @ts-ignore
import Manifest from "./manifest.json";
// @ts-ignore
import RoutesManifestJson from "./routes-manifest.json";
import {
  ExternalRoute,
  getStaticRegenerationResponse,
  handleApi,
  handleDefault,
  handleFallback,
  PublicFileRoute,
  StaticRoute
} from "@sls-next/core";

import {
  BuildManifest,
  EventResponse,
  PerfLogger,
  PreRenderedManifest as PrerenderManifestType,
  RequestEvent,
  RoutesManifest
} from "./types";
import { performance } from "perf_hooks";
import { ServerResponse } from "http";
import { Readable } from "stream";
import { httpCompat } from "./compat/apigw";
import { createExternalRewriteResponse } from "./lib/createExternalRewriteResponse";
import { s3StorePage } from "./lib/s3StorePage";

const SERVER_CACHE_CONTROL_HEADER =
  "public, max-age=0, s-maxage=2678400, must-revalidate";
const SERVER_NO_CACHE_CACHE_CONTROL_HEADER =
  "public, max-age=0, s-maxage=0, must-revalidate";

const manifest: BuildManifest = Manifest;
const prerenderManifest: PrerenderManifestType = PrerenderManifest;
const routesManifest: RoutesManifest = RoutesManifestJson;

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

export const handler = async (event: RequestEvent): Promise<EventResponse> => {
  const { now, log } = perfLogger(manifest.logLambdaExecutionTimes);

  const tHandlerBegin = now();

  const response: EventResponse = await handleRequest(event);

  const tHandlerEnd = now();

  log("handler execution time", tHandlerBegin, tHandlerEnd);

  return response;
};

/*
 * Gets an S3 file to fulfill request.
 *
 * Resolves true if successful.
 */
const getS3File = async (
  res: ServerResponse,
  file: string,
  path: string,
  revalidate?: number | false
): Promise<boolean> => {
  // Lazily import only S3Client to reduce init times until actually needed
  const { S3Client } = await import("@aws-sdk/client-s3/S3Client");

  const s3 = new S3Client({
    maxAttempts: 3,
    region: manifest.region
  });

  const s3Key = `${path}${file}`;
  const { GetObjectCommand } = await import(
    "@aws-sdk/client-s3/commands/GetObjectCommand"
  );

  // S3 Body is stream per: https://github.com/aws/aws-sdk-js-v3/issues/1096
  const getStream = await import("get-stream");

  const s3Params = {
    Bucket: manifest.bucketName,
    Key: s3Key
  };

  try {
    const s3Response = await s3.send(new GetObjectCommand(s3Params));
    const bodyString = await getStream.default(s3Response.Body as Readable);
    if (s3Response.ContentType) {
      res.setHeader("Content-Type", s3Response.ContentType);
    }
    const { cacheControl } = ((s3Response.Expires || revalidate) &&
      getStaticRegenerationResponse({
        expiresHeader: s3Response.Expires?.toJSON() || "",
        lastModifiedHeader: s3Response.LastModified?.toJSON() || "",
        initialRevalidateSeconds: revalidate
      })) || {
      cacheControl: s3Response.CacheControl || SERVER_CACHE_CONTROL_HEADER
    };
    res.setHeader("Cache-Control", cacheControl);

    res.write(bodyString);
    return true;
  } catch (error) {
    return false;
  }
};

const handleStatic = (staticRoute: StaticRoute, res: ServerResponse) => {
  const { file, isData, revalidate } = staticRoute;
  const path = isData
    ? `${routesManifest.basePath}`
    : `${routesManifest.basePath}/static-pages/${manifest.buildId}`;

  const relativeFile = isData ? file : file.slice("pages".length);
  if (staticRoute.statusCode) {
    res.statusCode = staticRoute.statusCode;
  }
  return getS3File(res, relativeFile, path, revalidate);
};

const handleRequest = async (event: RequestEvent): Promise<EventResponse> => {
  const { req, res, responsePromise } = httpCompat(event);

  const { now, log } = perfLogger(manifest.logLambdaExecutionTimes);

  let tBeforeSSR = null;
  const getPage = (pagePath: string) => {
    const tBeforePageRequire = now();
    const page = require(`./${pagePath}`); // eslint-disable-line
    const tAfterPageRequire = (tBeforeSSR = now());
    log("require JS execution time", tBeforePageRequire, tAfterPageRequire);
    return page;
  };

  const apiRoute = event.rawPath.startsWith(`${routesManifest.basePath}/api/`)
    ? await handleApi(
        { req, res, responsePromise },
        manifest,
        routesManifest,
        getPage
      )
    : undefined;

  if (apiRoute === true) {
    return await responsePromise;
  }

  const route =
    apiRoute ||
    (await handleDefault(
      { req, res, responsePromise },
      manifest,
      prerenderManifest,
      routesManifest,
      getPage
    ));

  if (tBeforeSSR) {
    const tAfterSSR = now();
    log("SSR execution time", tBeforeSSR, tAfterSSR);
  }

  if (!route) {
    return responsePromise;
  }

  if (route.isExternal) {
    const external = route as ExternalRoute;
    const { path } = external;
    await createExternalRewriteResponse(path, req, res, event.body);
    return responsePromise;
  }

  if (route.isPublicFile) {
    const { file } = route as PublicFileRoute;
    if (await getS3File(res, file, `${routesManifest.basePath}/public`)) {
      res.end();
      return responsePromise;
    }
  } else {
    const staticRoute: StaticRoute = route;
    if (await handleStatic(staticRoute, res)) {
      if (staticRoute.statusCode == 500) {
        res.setHeader("Cache-Control", SERVER_NO_CACHE_CACHE_CONTROL_HEADER);
      }
      res.end();
      return responsePromise;
    }
  }

  // Fallback

  const fallbackRoute = await handleFallback(
    { req, res, responsePromise },
    route,
    manifest,
    routesManifest,
    getPage
  );

  if (!fallbackRoute) {
    return responsePromise;
  }

  if (!fallbackRoute.isStatic) {
    const { renderOpts, html } = fallbackRoute;
    const { pageData } = renderOpts;
    const { expires } = await s3StorePage({
      basePath: routesManifest.basePath,
      bucketName: manifest.bucketName,
      buildId: manifest.buildId,
      html,
      pageData,
      region: manifest.region,
      uri: fallbackRoute.route.file
    });

    const { cacheControl } = (expires &&
      getStaticRegenerationResponse({
        expiresHeader: expires.toJSON(),
        lastModifiedHeader: undefined,
        initialRevalidateSeconds: fallbackRoute.route.revalidate
      })) || { cacheControl: SERVER_CACHE_CONTROL_HEADER };
    res.setHeader("Cache-Control", cacheControl);

    if (fallbackRoute.route.isData) {
      res.setHeader("Content-Type", "application/json");
      res.end(pageData);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    }
    return responsePromise;
  }

  const staticRoute: StaticRoute = fallbackRoute;
  if (!(await handleStatic(staticRoute, res))) {
    throw new Error("Failed to get error page!");
  }
  res.setHeader("Cache-Control", SERVER_NO_CACHE_CACHE_CONTROL_HEADER);
  res.end();
  return responsePromise;
};
