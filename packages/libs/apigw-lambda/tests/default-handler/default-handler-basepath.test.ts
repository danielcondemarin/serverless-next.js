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
  () => require("./default-basepath-routes-manifest.json"),
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
  });

  beforeEach(() => {
    (s3Client.send as any).mockClear();
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("HTML pages routing", () => {
    it.each`
      path           | expectedPage
      ${"/basepath"} | ${"/index.html"}
    `(
      "serves page $expectedPage from S3 for path $path",
      async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(200);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: `/basepath/static-pages/build-id${expectedPage}`
          })
        );
      }
    );
  });

  describe("Public files routing", () => {
    it.each`
      path                         | expectedFile
      ${"/basepath/manifest.json"} | ${"/basepath/public/manifest.json"}
    `(
      "serves public file at path $path from S3 /public folder",
      async ({ path, expectedFile }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(200);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: expectedFile
          })
        );
      }
    );
  });

  describe("SSR pages routing", () => {
    it.each`
      path               | expectedPage
      ${"/basepath/abc"} | ${"pages/[root].js"}
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

  describe("SSG page routing", () => {
    it.each`
      path                                  | expectedPage
      ${"/basepath/fallback/not-yet-built"} | ${"/fallback/not-yet-built.html"}
    `(
      "serves page $expectedPage from S3 for path $path",
      async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(200);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: `/basepath/static-pages/build-id${expectedPage}`
          })
        );
      }
    );

    describe("dynamic fallback", () => {
      beforeEach(() => {
        (s3Client as any).fail(1);
      });

      afterAll(() => {
        (s3Client as any).fail(0);
      });

      it.each`
        path                                           | statusCode | expectedPage
        ${"/basepath/fallback/not-yet-built"}          | ${200}     | ${"/fallback/[slug].html"}
        ${"/basepath/no-fallback/example-static-page"} | ${404}     | ${"/404.html"}
      `(
        "serves $expectedPage for path $path when page is not found",
        async ({ path, expectedPage, statusCode }) => {
          const event = createRequestEvent({
            uri: path
          });

          const result = await handler(event);

          expect(result.statusCode).toEqual(statusCode);
          expect(s3Client.send).toHaveBeenLastCalledWith(
            expect.objectContaining({
              Command: "GetObjectCommand",
              Key: `/basepath/static-pages/build-id${expectedPage}`
            })
          );
        }
      );

      it.each`
        path                                           | expectedPage
        ${"/basepath/fallback-blocking/not-yet-built"} | ${"pages/fallback-blocking/[slug].js"}
      `(
        "renders $expectedPage for path $path when page is not found",
        async ({ path, expectedPage }) => {
          const event = createRequestEvent({
            uri: path
          });

          mockPageRequire(expectedPage);

          const response = await handler(event);

          const decodedBody = Buffer.from(
            response.body as string,
            "base64"
          ).toString("utf8");
          expect(decodedBody).toBe("<div>Rendered Page</div>");
          expect(response.statusCode).toBe(200);
        }
      );

      it.each`
        path                                           | expectedPage
        ${"/basepath/fallback-blocking/not-yet-built"} | ${"pages/fallback-blocking/[slug].js"}
      `("Uploads page for $path", async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const response = await handler(event);

        const page = path.slice(9);
        expect(response.statusCode).toBe(200);
        expect(s3Client.send).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `basepath/_next/data/build-id/pages${page}.json`,
            ContentType: "application/json"
          })
        );
        expect(s3Client.send).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `basepath/static-pages/build-id/pages${page}.html`,
            ContentType: "text/html"
          })
        );
      });
    });
  });

  describe("Data Requests", () => {
    it.each`
      path                                              | expectedPage
      ${"/basepath/_next/data/build-id/customers.json"} | ${"pages/customers.js"}
    `(
      "serves json data via SSR for SSR path $path",
      async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const result = await handler(event);

        const cfResponse = result as EventResponse;
        const decodedBody = Buffer.from(
          cfResponse.body as string,
          "base64"
        ).toString("utf8");

        expect(decodedBody).toEqual(JSON.stringify({ page: expectedPage }));
        expect(cfResponse.statusCode).toEqual(200);
      }
    );

    it.each`
      path                               | expectedUri
      ${"/basepath/_next/data/build-id"} | ${"/basepath/_next/data/build-id/index.json"}
    `(
      "serves json data via S3 for SSG path $path",
      async ({ path, expectedUri }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(200);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: expectedUri
          })
        );
      }
    );

    it("serves JSON with Cache-Control and Content-Type from S3", async () => {
      const event = createRequestEvent({
        uri: "/basepath/_next/data/build-id/index.json"
      });

      const response = await handler(event);

      expect(response.headers).toEqual({
        "Cache-Control": "public, max-age=0, s-maxage=2678400, must-revalidate",
        "Content-Type": "application/json"
      });
    });

    describe("dynamic fallback", () => {
      beforeEach(() => {
        (s3Client as any).fail(1);
      });

      afterAll(() => {
        (s3Client as any).fail(0);
      });

      it.each`
        path                                                           | expectedPage
        ${"/basepath/_next/data/build-id/fallback/not-yet-built.json"} | ${"pages/fallback/[slug].js"}
        ${"/basepath/_next/data/build-id/fallback-blocking/foo.json"}  | ${"pages/fallback-blocking/[slug].js"}
      `("Uploads page for $path", async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const response = await handler(event);

        expect(response.statusCode).toBe(200);

        const page = path
          .replace("/basepath/_next/data/build-id", "")
          .replace(".json", "");
        expect(s3Client.send).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `basepath/_next/data/build-id${page}.json`,
            ContentType: "application/json"
          })
        );
        expect(s3Client.send).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `basepath/static-pages/build-id${page}.html`,
            ContentType: "text/html"
          })
        );
      });
    });

    /*
    it("returns a correct cache control header when an expiry header in the future is sent", async () => {
      const event = createRequestEvent({
        uri: "/customers",
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("cache-control");
      expect(response.headers["cache-control"][0].value).toBe(
        "public, max-age=0, s-maxage=3, must-revalidate"
      );
    });

    it("returns a correct cache control header when an expiry header in the past is sent", async () => {
      mockTriggerStaticRegeneration.mockReturnValueOnce(
        Promise.resolve({ throttle: false })
      );
      const event = createRequestEvent({
        uri: "/customers",
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("cache-control");
      expect(response.headers["cache-control"][0].value).toBe(
        "public, max-age=0, s-maxage=0, must-revalidate"
      );
    });

    it("returns a correct cache control header when a last-modified header is sent", async () => {
      mockTriggerStaticRegeneration.mockReturnValueOnce(
        Promise.resolve({ throttle: false })
      );
      const event = createRequestEvent({
        uri: "/preview",
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("cache-control");
      expect(response.headers["cache-control"][0].value).toBe(
        "public, max-age=0, s-maxage=2, must-revalidate"
      );
    });

    it("returns a correct throttled cache header when 'throttle' value is returned true", async () => {
      mockTriggerStaticRegeneration.mockReturnValueOnce(
        Promise.resolve({ throttle: true })
      );
      const event = createRequestEvent({
        uri: "/preview",
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("cache-control");
      expect(response.headers["cache-control"][0].value).toBe(
        "public, max-age=0, s-maxage=1, must-revalidate"
      );
    });*/
  });

  describe("404 page", () => {
    it("returns 404 page if request path is outside basepath", async () => {
      const event = createRequestEvent({
        uri: "/"
      });

      const result = await handler(event);

      expect(result.statusCode).toEqual(404);
      expect(s3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Command: "GetObjectCommand",
          Key: "/basepath/static-pages/build-id/404.html"
        })
      );
    });

    it("serves 404 with correct Cache-Control and Content-Type", async () => {
      const event = createRequestEvent({
        uri: "/basepath/page/does/not/exist"
      });

      const response = await handler(event);

      expect(response.headers).toEqual({
        "Cache-Control": "public, max-age=0, s-maxage=2678400, must-revalidate",
        "Content-Type": "text/html"
      });
    });

    it.each`
      path
      ${"/basepath/_next/data/unmatched"}
    `(
      "returns 404 page if data request can't be matched for path: $path",
      async ({ path }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(404);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: "/basepath/static-pages/build-id/404.html"
          })
        );
      }
    );
  });
});
