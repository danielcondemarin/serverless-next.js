import { handler } from "../../src/default-handler";
import { createRequestEvent } from "../test-utils";
import { EventResponse } from "../../src/types";
import { S3Client } from "@aws-sdk/client-s3/S3Client";

jest.mock("node-fetch", () => require("fetch-mock-jest").sandbox());

jest.mock("@aws-sdk/client-s3/S3Client", () =>
  require("../mocks/s3/aws-sdk-s3-client.mock")
);

jest.mock("@aws-sdk/client-s3/commands/GetObjectCommand", () =>
  require("../mocks/s3/aws-sdk-s3-client-get-object-command.mock")
);

jest.mock("@aws-sdk/client-s3/commands/PutObjectCommand", () =>
  require("../mocks/s3/aws-sdk-s3-client-put-object-command.mock")
);

jest.mock(
  "../../src/manifest.json",
  () => require("./default-build-manifest.json"),
  {
    virtual: true
  }
);

jest.mock(
  "../../src/routes-manifest.json",
  () => require("./default-routes-manifest.json"),
  {
    virtual: true
  }
);

jest.mock(
  "../../src/prerender-manifest.json",
  () => require("./prerender-manifest.json"),
  {
    virtual: true
  }
);

const mockPageRequire = (mockPagePath: string): void => {
  jest.mock(
    `../../src/${mockPagePath}`,
    () => require(`../shared-fixtures/built-artifact/${mockPagePath}`),
    {
      virtual: true
    }
  );
};

const s3Client = new S3Client({});

describe("Lambda@Edge", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleWarnSpy = jest.spyOn(console, "error").mockReturnValue();
    (s3Client.send as any).mockClear();
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("API pages routing", () => {
    it.each`
      path                   | expectedPage
      ${"/api/getCustomers"} | ${"pages/api/getCustomers.js"}
      ${"/api/getUser"}      | ${"pages/api/getUser.js"}
      ${"/api/users/1"}      | ${"pages/api/users/[id].js"}
    `(
      "renders page $expectedPage for path $path",
      async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const response = await handler(event);

        const cfResponse = response as EventResponse;
        const decodedBody = Buffer.from(
          cfResponse.body as string,
          "base64"
        ).toString("utf8");

        expect(decodedBody).toEqual(expectedPage);
        expect(cfResponse.statusCode).toEqual(200);
      }
    );
  });

  describe("404 page", () => {
    it("returns 404 page if request path can't be matched to any api routes", async () => {
      const event = createRequestEvent({
        uri: "/api/does/not/exist"
      });

      const result = await handler(event);

      expect(result.statusCode).toEqual(404);
      expect(s3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Command: "GetObjectCommand",
          Key: "/static-pages/build-id/404.html"
        })
      );
    });
  });

  describe("External Rewrites", () => {
    it.each`
      uri                        | rewriteUri                | method
      ${"/api/external-rewrite"} | ${"https://external.com"} | ${"GET"}
      ${"/api/external-rewrite"} | ${"https://external.com"} | ${"POST"}
    `(
      "serves external rewrite $rewriteUri for rewritten path $uri and method $method",
      async ({ uri, rewriteUri, method }) => {
        const { default: fetchMock } = await import("node-fetch");

        fetchMock.reset();
        fetchMock.mock(rewriteUri, "external");

        let [path, querystring] = uri.split("?");

        const event = createRequestEvent({
          uri: path,
          querystring: querystring,
          method: method,
          body: "eyJhIjoiYiJ9",
          isBase64Encoded: true
        });

        const response: EventResponse = await handler(event);

        expect(fetchMock).toHaveLastFetched("https://external.com", {
          method: method
        });
        expect(response).toEqual({
          body: "ZXh0ZXJuYWw=",
          isBase64Encoded: true,
          headers: {
            "content-length": "8",
            "content-type": "text/plain;charset=UTF-8"
          },
          statusCode: 200
        });

        expect(fetchMock).toHaveLastFetched("https://external.com", {
          method: method
        });
      }
    );
  });
});
