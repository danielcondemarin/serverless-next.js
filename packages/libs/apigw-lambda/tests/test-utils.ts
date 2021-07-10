import path from "path";
import { remove } from "fs-extra";
import { RequestEvent } from "../src/types";

export const cleanupDir = (dir: string): Promise<void> => {
  return remove(dir);
};

export const removeNewLineChars = (text: string): string =>
  text.replace(/(\r\n|\n|\r)/gm, "");

export const getNextBinary = (): string =>
  path.join(require.resolve("next"), "../../../../.bin/next");

const toQueryParams = (qs: string) =>
  Object.fromEntries(
    qs.split("&").map((kv) => {
      const [key, value] = kv.split("=");
      return [key, value];
    })
  );

export const createRequestEvent = ({
  uri,
  querystring,
  headers = {},
  method = "GET",
  body,
  isBase64Encoded = false
}: {
  uri: string;
  querystring?: string;
  headers?: { [key: string]: string };
  method?: string;
  body?: string;
  isBase64Encoded?: boolean;
}): RequestEvent => ({
  version: "2",
  routeKey: "$default",
  rawPath: uri.split("?")[0],
  rawQueryString: querystring || uri.split("?")[1],
  headers,
  queryStringParameters: querystring ? toQueryParams(querystring) : {},
  requestContext: {
    accountId: "test-account",
    apiId: "test-api",
    domainName: "test-domain.execute-api.us-east-1.amazonaws.com",
    domainPrefix: "test-domain",
    http: {
      method,
      path: uri.split("?")[0],
      protocol: "HTTP/1.1",
      sourceIp: "0.0.0.0",
      userAgent: "agent"
    },
    requestId: "request-id",
    routeKey: "$default",
    stage: "dev",
    time: "20/May/2020:18:40:00 +0000",
    timeEpoch: 1590000000000
  },
  isBase64Encoded,
  body
});

export async function runRedirectTestWithHandler(
  // eslint-disable-next-line @typescript-eslint/ban-types
  handler: Function,
  path: string,
  expectedRedirect: string,
  statusCode: number,
  querystring?: string,
  host?: string,
  headers?: { key: string; value: string }
): Promise<void> {
  const event = createRequestEvent({
    uri: path,
    querystring: querystring,
    headers: { ...headers, ...(host ? { Host: host } : {}) }
  });

  const result = await handler(event);

  const refresh: string | undefined =
    statusCode === 308 ? `0;url=${expectedRedirect}` : undefined;

  expect(result.headers).toEqual({
    "Cache-Control": "s-maxage=0",
    Location: expectedRedirect,
    Refresh: refresh
  });
  expect(result.statusCode.toString()).toEqual(statusCode.toString());
}
