import { IncomingMessage, ServerResponse } from "http";
import Query from "querystring";
import { Stream } from "stream";
import { EventResponse, RequestEvent } from "../types";

export const httpCompat = (
  event: RequestEvent
): {
  req: IncomingMessage;
  res: ServerResponse;
  responsePromise: Promise<EventResponse>;
} => {
  const response: EventResponse = {
    headers: {}
  };

  const newStream = new Stream.Readable();
  const req = Object.assign(newStream, IncomingMessage.prototype) as any;

  const { queryStringParameters, rawPath } = event;
  const qs = queryStringParameters
    ? Query.stringify(queryStringParameters)
    : "";

  const hasQueryString = qs.length > 0;

  req.url = hasQueryString ? `${rawPath}?${qs}` : rawPath;

  req.method = event.requestContext.http.method;
  req.rawHeaders = [];
  req.headers = {};

  for (const [key, value] of Object.entries(event.headers)) {
    req.headers[key.toLowerCase()] = value;
  }

  req.getHeader = (name: string) => {
    return req.headers[name.toLowerCase()];
  };
  req.getHeaders = () => {
    return req.headers;
  };
  req.connection = {};

  const res = new Stream() as any;
  Object.defineProperty(res, "statusCode", {
    get() {
      return response.statusCode;
    },
    set(statusCode) {
      response.statusCode = statusCode;
    }
  });

  const headerNames: { [key: string]: string } = {};
  res.headers = {};
  res.writeHead = (
    status: number,
    headers: { [key: string]: string | string[] }
  ) => {
    response.statusCode = status;
    res.headers = { ...res.headers, ...headers };
  };
  res.write = (chunk: Buffer | string) => {
    if (!response.body) {
      response.body = "";
    }
    response.body = response.body + chunk.toString("utf8");
  };
  res.setHeader = (name: string, value: string) => {
    headerNames[name.toLowerCase()] = name;
    res.headers[name.toLowerCase()] = value;
  };
  res.removeHeader = (name: string) => {
    delete res.headers[name.toLowerCase()];
  };
  res.getHeader = (name: string) => {
    return res.headers[name.toLowerCase()];
  };
  res.getHeaders = () => {
    return res.headers;
  };
  res.hasHeader = (name: string) => {
    return !!res.getHeader(name);
  };

  const onResEnd =
    (resolve: (value: EventResponse) => void) => (text: Buffer | string) => {
      if (text) res.write(text);
      if (!res.statusCode) {
        res.statusCode = 200;
      }

      if (response.body) {
        response.body = Buffer.from(response.body).toString("base64");
        response.isBase64Encoded = true;
      }
      res.writeHead(response.statusCode);

      response.headers = {};
      for (const [key, value] of Object.entries(res.headers) as [
        string,
        string | string[]
      ][]) {
        const val = Array.isArray(value) ? value.join(",") : value;
        response.headers[headerNames[key] || key] = val;
      }

      resolve(response);
    };

  const responsePromise: Promise<EventResponse> = new Promise((resolve) => {
    res.end = onResEnd(resolve);
  });

  if (event.body) {
    req.push(event.body, event.isBase64Encoded ? "base64" : undefined);
  }

  req.push(null);

  return { req, res, responsePromise };
};
