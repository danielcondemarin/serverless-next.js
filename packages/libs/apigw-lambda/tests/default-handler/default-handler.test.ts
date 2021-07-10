import { handler } from "../../src/default-handler";
import { createRequestEvent } from "../test-utils";
import { EventResponse } from "../../src/types";
import { S3Client } from "@aws-sdk/client-s3/S3Client";
import { Readable } from "stream";

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
const mockS3Send = s3Client.send as jest.Mock;

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
      path                       | expectedPage
      ${"/"}                     | ${"/index.html"}
      ${"/terms"}                | ${"/terms.html"}
      ${"/users/batman"}         | ${"/users/[...user].html"}
      ${"/users/test/catch/all"} | ${"/users/[...user].html"}
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
            Key: `/static-pages/build-id${expectedPage}`
          })
        );
      }
    );

    it.each`
      path
      ${"//example.com"}
      ${"//example.com/"}
    `(`returns 404 without redirect for $path`, async ({ path }) => {
      const event = createRequestEvent({
        uri: path
      });

      const result = await handler(event);

      expect(result.statusCode).toEqual(404);
      expect(s3Client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          Command: "GetObjectCommand",
          Key: `/static-pages/build-id/404.html`
        })
      );
    });

    it("serves HTML page with Cache-Control and Content-Type from S3", async () => {
      const event = createRequestEvent({
        uri: "/"
      });

      const response = await handler(event);

      expect(response.headers).toEqual({
        "Cache-Control": "public, max-age=0, s-maxage=2678400, must-revalidate",
        "Content-Type": "text/html"
      });
    });
  });

  describe("Public files routing", () => {
    it.each`
      path
      ${"/manifest.json"}
      ${"/file%20with%20spaces.json"}
    `(
      "serves public file at path $path from S3 /public folder",
      async ({ path }) => {
        const event = createRequestEvent({
          uri: path
        });

        const result = await handler(event);

        expect(result.statusCode).toEqual(200);
        expect(s3Client.send).toHaveBeenCalledWith(
          expect.objectContaining({
            Command: "GetObjectCommand",
            Key: `/public${path}`
          })
        );
      }
    );
  });

  describe("SSR pages routing", () => {
    it.each`
      path                           | expectedPage
      ${"/abc"}                      | ${"pages/[root].js"}
      ${"/blog/foo"}                 | ${"pages/blog/[id].js"}
      ${"/customers/test/catch/all"} | ${"pages/customers/[...catchAll].js"}
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

    it.each`
      path                       | expectedPage
      ${"/async-page?key=value"} | ${"pages/async-page.js"}
    `(
      "serves page $expectedPage for $path with correct query string",
      async ({ path, expectedPage }) => {
        const [uri, querystring] = path.split("?");
        mockPageRequire(expectedPage);

        const page = require(`../../src/${expectedPage}`);
        const event = createRequestEvent({
          uri,
          querystring
        });

        const result = await handler(event);
        const call = page.render.mock.calls[0];
        const firstArgument = call[0];
        expect(firstArgument).toMatchObject({ url: path });
        const decodedBody = Buffer.from(
          result.body as string,
          "base64"
        ).toString("utf8");
        expect(decodedBody).toEqual(expectedPage);
      }
    );
  });

  describe("SSG page routing", () => {
    it.each`
      path                                  | expectedPage
      ${"/fallback/not-yet-built"}          | ${"/fallback/not-yet-built.html"}
      ${"/fallback-blocking/not-yet-built"} | ${"/fallback-blocking/not-yet-built.html"}
      ${"/no-fallback/example-static-page"} | ${"/no-fallback/example-static-page.html"}
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
            Key: `/static-pages/build-id${expectedPage}`
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
        path                                  | statusCode | expectedPage
        ${"/fallback/not-yet-built"}          | ${200}     | ${"/fallback/[slug].html"}
        ${"/no-fallback/example-static-page"} | ${404}     | ${"/404.html"}
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
              Key: `/static-pages/build-id${expectedPage}`
            })
          );
        }
      );

      it.each`
        path                                  | expectedPage
        ${"/fallback-blocking/not-yet-built"} | ${"pages/fallback-blocking/[slug].js"}
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
        path                                  | expectedPage
        ${"/fallback-blocking/not-yet-built"} | ${"pages/fallback-blocking/[slug].js"}
      `("Uploads page for $path", async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        expect(s3Client.send).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `_next/data/build-id/pages${path}.json`,
            ContentType: "application/json"
          })
        );
        expect(s3Client.send).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `static-pages/build-id/pages${path}.html`,
            ContentType: "text/html"
          })
        );
      });
    });

    it("returns cache control header from S3 response", async () => {
      const event = createRequestEvent({
        uri: "/preview"
      });
      mockS3Send.mockReturnValueOnce({
        Body: Readable.from(["S3Body"]),
        CacheControl: "test",
        ContentType: "text/html"
      });

      const response = await handler(event);
      expect(mockS3Send).toHaveBeenCalled();
      expect(response.headers).toHaveProperty("Cache-Control");
      expect(response.headers?.["Cache-Control"]).toEqual("test");
    });

    it("returns a correct cache control header when an expiry header in the future is sent", async () => {
      const event = createRequestEvent({
        uri: "/preview"
      });
      mockS3Send.mockReturnValueOnce({
        Body: Readable.from(["S3Body"]),
        Expires: new Date(new Date().getTime() + 1000 * 3),
        ContentType: "text/html"
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("Cache-Control");
      expect(response.headers?.["Cache-Control"]).toEqual(
        "public, max-age=0, s-maxage=3, must-revalidate"
      );
    });

    it("returns a correct cache control header when an expiry header in the past is sent", async () => {
      const event = createRequestEvent({
        uri: "/preview"
      });
      mockS3Send.mockReturnValueOnce({
        Body: Readable.from(["S3Body"]),
        Expires: new Date(new Date().getTime() - 1000 * 3),
        ContentType: "text/html"
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("Cache-Control");
      expect(response.headers?.["Cache-Control"]).toEqual(
        "public, max-age=0, s-maxage=0, must-revalidate"
      );
    });

    it("returns a correct cache control header when a last-modified header is sent", async () => {
      const event = createRequestEvent({
        uri: "/preview"
      });
      mockS3Send.mockReturnValueOnce({
        Body: Readable.from(["S3Body"]),
        LastModified: new Date(new Date().getTime() - 1000 * 3),
        ContentType: "text/html"
      });

      const response = await handler(event);
      expect(response.headers).toHaveProperty("Cache-Control");
      expect(response.headers?.["Cache-Control"]).toEqual(
        "public, max-age=0, s-maxage=2, must-revalidate"
      );
    });
    /*
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

  describe("Data Requests", () => {
    it.each`
      path                                                      | expectedPage
      ${"/_next/data/build-id/customers.json"}                  | ${"pages/customers.js"}
      ${"/_next/data/build-id/customers/superman.json"}         | ${"pages/customers/[customer].js"}
      ${"/_next/data/build-id/customers/superman/profile.json"} | ${"pages/customers/[customer]/profile.js"}
      ${"/_next/data/build-id/customers/test/catch/all.json"}   | ${"pages/customers/[...catchAll].js"}
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
      path                                                  | expectedUri
      ${"/_next/data/build-id"}                             | ${"/_next/data/build-id/index.json"}
      ${"/_next/data/build-id/index.json"}                  | ${"/_next/data/build-id/index.json"}
      ${"/_next/data/build-id/fallback/not-yet-built.json"} | ${"/_next/data/build-id/fallback/not-yet-built.json"}
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
        uri: "/_next/data/build-id/index.json"
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
        path                                                  | expectedPage
        ${"/_next/data/build-id/fallback/not-yet-built.json"} | ${"pages/fallback/[slug].js"}
        ${"/_next/data/build-id/fallback-blocking/foo.json"}  | ${"pages/fallback-blocking/[slug].js"}
      `("Uploads page for $path", async ({ path, expectedPage }) => {
        const event = createRequestEvent({
          uri: path
        });

        mockPageRequire(expectedPage);

        const response = await handler(event);

        expect(response.statusCode).toBe(200);

        const page = path
          .replace("/_next/data/build-id", "")
          .replace(".json", "");
        expect(s3Client.send).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `_next/data/build-id${page}.json`,
            ContentType: "application/json"
          })
        );
        expect(s3Client.send).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            Command: "PutObjectCommand",
            Key: `static-pages/build-id${page}.html`,
            ContentType: "text/html"
          })
        );
      });
    });
  });

  describe("S3 requests", () => {
    it("use default s3 endpoint when region is undefined", () => {
      expect(s3Client.config.region).toBeUndefined();
    });
  });

  describe("404 page", () => {
    it("returns 404 page if request path can't be matched to any page / api routes", async () => {
      const event = createRequestEvent({
        uri: "/page/does/not/exist"
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

    it("serves 404 with correct Cache-Control and Content-Type", async () => {
      const event = createRequestEvent({
        uri: "/page/does/not/exist"
      });

      const response = await handler(event);

      expect(response.headers).toEqual({
        "Cache-Control": "public, max-age=0, s-maxage=2678400, must-revalidate",
        "Content-Type": "text/html"
      });
    });

    it.each`
      path
      ${"/_next/data/unmatched"}
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
            Key: "/static-pages/build-id/404.html"
          })
        );
      }
    );
  });

  describe("500 page", () => {
    it("renders 500 page if page render has an error", async () => {
      const event = createRequestEvent({
        uri: "/erroredPage"
      });

      mockPageRequire("pages/erroredPage.js");
      mockPageRequire("pages/_error.js");

      const response = (await handler(event)) as EventResponse;
      const body = response.body as string;
      const decodedBody = Buffer.from(body, "base64").toString("utf8");

      expect(decodedBody).toEqual("pages/_error.js - 500");
      expect(response.statusCode).toEqual(500);
    });
  });

  describe("External Rewrites", () => {
    it.each`
      uri                    | rewriteUri                | method
      ${"/external-rewrite"} | ${"https://external.com"} | ${"GET"}
      ${"/external-rewrite"} | ${"https://external.com"} | ${"POST"}
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
