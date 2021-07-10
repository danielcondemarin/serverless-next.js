import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2
} from "aws-lambda";
import { ApiManifest, PageManifest } from "@sls-next/core";
export { ImageConfig, ImagesManifest, RoutesManifest } from "@sls-next/core";

export type BuildManifest = ApiManifest &
  PageManifest & {
    bucketName: string;
    enableHTTPCompression?: boolean;
    logLambdaExecutionTimes?: boolean;
    region: string;
  };

export type RequestEvent = APIGatewayProxyEventV2;

export type EventResponse = APIGatewayProxyStructuredResultV2;

export type PreRenderedManifest = {
  version: 3;
  routes: {
    [route: string]: {
      initialRevalidateSeconds: number | false;
      srcRoute: string | null;
      dataRoute: string;
    };
  };
  dynamicRoutes: {
    [route: string]: {
      routeRegex: string;
      fallback: string | false;
      dataRoute: string;
      dataRouteRegex: string;
    };
  };
  preview: {
    previewModeId: string;
    previewModeSigningKey: string;
    previewModeEncryptionKey: string;
  };
};

export type PerfLogger = {
  now: () => number | undefined;
  log: (metricDescription: string, t1?: number, t2?: number) => void;
};
