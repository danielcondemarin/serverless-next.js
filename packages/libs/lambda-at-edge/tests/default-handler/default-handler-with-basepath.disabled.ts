import { createCloudFrontEvent } from "../test-utils";
import {
  CloudFrontRequest,
  CloudFrontResultResponse,
  CloudFrontOrigin
} from "aws-lambda";
import { runRedirectTestWithHandler } from "../utils/runRedirectTest";

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

describe("Lambda@Edge", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "error").mockReturnValue();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });
  describe.each`
    trailingSlash
    ${false}
    ${true}
  `("Routing with trailingSlash = $trailingSlash", ({ trailingSlash }) => {
    let handler: any;
    let runRedirectTest: (
      path: string,
      expectedRedirect: string,
      statusCode: number,
      querystring?: string,
      host?: string,
      requestHeaders?: { [p: string]: { key: string; value: string }[] }
    ) => Promise<void>;
    beforeEach(() => {
      jest.resetModules();

      if (trailingSlash) {
        jest.mock(
          "../../src/manifest.json",
          () => require("./default-build-manifest-with-trailing-slash.json"),
          {
            virtual: true
          }
        );

        // Note that default trailing slash redirects have already been removed from routes-manifest.json (done in deploy step in real app)
        jest.mock(
          "../../src/routes-manifest.json",
          () =>
            require("./default-basepath-routes-manifest-with-trailing-slash.json"),
          {
            virtual: true
          }
        );
      } else {
        jest.mock(
          "../../src/manifest.json",
          () => require("./default-build-manifest.json"),
          {
            virtual: true
          }
        );

        // Note that default trailing slash redirects have already been removed from routes-manifest.json (done in deploy step in real app)
        jest.mock(
          "../../src/routes-manifest.json",
          () => require("./default-basepath-routes-manifest.json"),
          {
            virtual: true
          }
        );
      }

      // Handler needs to be dynamically required to use above mocked manifests
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require("../../src/default-handler").handler;

      runRedirectTest = async (
        path: string,
        expectedRedirect: string,
        statusCode: number,
        querystring?: string,
        host?: string,
        requestHeaders?: { [p: string]: { key: string; value: string }[] }
      ): Promise<void> => {
        await runRedirectTestWithHandler(
          handler,
          path,
          expectedRedirect,
          statusCode,
          querystring,
          host,
          requestHeaders
        );
      };
    });

    afterEach(() => {
      jest.unmock("../../src/manifest.json");
    });

    describe("HTML pages routing", () => {
      it.each`
        path                                           | expectedPage
        ${"/basepath"}                                 | ${"/index.html"}
        ${"/basepath/terms"}                           | ${"/terms.html"}
        ${"/basepath/users/batman"}                    | ${"/users/[...user].html"}
        ${"/basepath/users/test/catch/all"}            | ${"/users/[...user].html"}
        ${"/basepath/no-fallback/example-static-page"} | ${"/no-fallback/example-static-page.html"}
        ${"/basepath/fallback/not-built"}              | ${"/fallback/not-built.html"}
        ${"/basepath/preview"}                         | ${"/preview.html"}
      `(
        "serves page $expectedPage from S3 for path $path",
        async ({ path, expectedPage }) => {
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/basepath/static-pages/build-id",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(expectedPage);
          expect(request.headers.host[0].key).toEqual("host");
          expect(request.headers.host[0].value).toEqual(
            "my-bucket.s3.amazonaws.com"
          );
        }
      );

      it.each`
        path
        ${"/basepath"}
        ${"/basepath/terms"}
        ${"/basepath/users/batman"}
        ${"/basepath/users/test/catch/all"}
        ${"/basepath/john/123"}
        ${"/basepath/no-fallback/example-static-page"}
        ${"/basepath/fallback/not-yet-built"}
      `(
        `path $path redirects if it ${
          trailingSlash ? "does not have" : "has"
        } a trailing slash`,
        async ({ path }) => {
          let expectedRedirect;
          if (trailingSlash) {
            expectedRedirect = path + "/";
          } else {
            expectedRedirect = path;
            path += "/";
          }
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );

      it("terms.html should return 200 status after successful S3 Origin response", async () => {
        const event = createCloudFrontEvent({
          uri: "/terms.html",
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-response" } as any,
          response: {
            status: "200"
          } as any
        });

        const response = (await handler(event)) as CloudFrontResultResponse;

        expect(response.status).toEqual("200");
      });
    });

    describe("Public files routing", () => {
      it("serves public file from S3 /public folder", async () => {
        const event = createCloudFrontEvent({
          uri: "/basepath/manifest.json",
          host: "mydistribution.cloudfront.net"
        });

        const result = await handler(event);

        const request = result as CloudFrontRequest;

        expect(request.origin).toEqual({
          s3: {
            authMethod: "origin-access-identity",
            domainName: "my-bucket.s3.amazonaws.com",
            path: "/basepath/public",
            region: "us-east-1"
          }
        });
        expect(request.uri).toEqual("/manifest.json");
      });

      it("public file should return 200 status after successful S3 Origin response", async () => {
        const event = createCloudFrontEvent({
          uri: "/manifest.json",
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-response" } as any,
          response: {
            status: "200"
          } as any
        });

        const response = (await handler(event)) as CloudFrontResultResponse;

        expect(response.status).toEqual("200");
      });

      it.each`
        path                          | expectedRedirect
        ${"/basepath/favicon.ico/"}   | ${"/basepath/favicon.ico"}
        ${"/basepath/manifest.json/"} | ${"/basepath/manifest.json"}
      `(
        "public files always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );
    });

    describe("SSR pages routing", () => {
      it.each`
        path                                       | expectedPage
        ${"/basepath/abc"}                         | ${"pages/[root].js"}
        ${"/basepath/blog/foo"}                    | ${"pages/blog/[id].js"}
        ${"/basepath/customers"}                   | ${"pages/customers.js"}
        ${"/basepath/customers/superman"}          | ${"pages/customers/[customer].js"}
        ${"/basepath/customers/superman/howtofly"} | ${"pages/customers/[customer]/[post].js"}
        ${"/basepath/customers/superman/profile"}  | ${"pages/customers/[customer]/profile.js"}
        ${"/basepath/customers/test/catch/all"}    | ${"pages/customers/[...catchAll].js"}
      `(
        "renders page $expectedPage for path $path",
        async ({ path, expectedPage }) => {
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          mockPageRequire(expectedPage);

          const response = await handler(event);

          const cfResponse = response as CloudFrontResultResponse;
          const decodedBody = Buffer.from(
            cfResponse.body as string,
            "base64"
          ).toString("utf8");

          expect(decodedBody).toEqual(expectedPage);
          expect(cfResponse.status).toEqual(200);
        }
      );

      it.each`
        path
        ${"/basepath/abc"}
        ${"/basepath/blog/foo"}
        ${"/basepath/customers"}
        ${"/basepath/customers/superman"}
        ${"/basepath/customers/superman/howtofly"}
        ${"/basepath/customers/superman/profile"}
        ${"/basepath/customers/test/catch/all"}
      `(
        `path $path redirects if it ${
          trailingSlash ? "does not have" : "has"
        } trailing slash`,
        async ({ path }) => {
          let expectedRedirect;
          if (trailingSlash) {
            expectedRedirect = path + "/";
          } else {
            expectedRedirect = path;
            path += "/";
          }
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );

      it.each`
        path
        ${"/basepath/abc"}
        ${"/basepath/blog/foo"}
        ${"/basepath/customers"}
        ${"/basepath/customers/superman"}
        ${"/basepath/customers/superman/howtofly"}
        ${"/basepath/customers/superman/profile"}
        ${"/basepath/customers/test/catch/all"}
      `("path $path passes querystring to redirected URL", async ({ path }) => {
        const querystring = "a=1&b=2";

        let expectedRedirect;
        if (trailingSlash) {
          expectedRedirect = `${path}/?${querystring}`;
        } else {
          expectedRedirect = `${path}?${querystring}`;
          path += "/";
        }

        await runRedirectTest(path, expectedRedirect, 308, querystring);
      });
    });

    describe("Data Requests", () => {
      it.each`
        path                                                               | expectedPage
        ${"/basepath/_next/data/build-id/customers.json"}                  | ${"pages/customers.js"}
        ${"/basepath/_next/data/build-id/customers/superman.json"}         | ${"pages/customers/[customer].js"}
        ${"/basepath/_next/data/build-id/customers/superman/profile.json"} | ${"pages/customers/[customer]/profile.js"}
      `(
        "serves json data via SSR for SSR path $path",
        async ({ path, expectedPage }) => {
          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net",
            config: { eventType: "origin-request" } as any
          });

          mockPageRequire(expectedPage);

          const result = await handler(event);

          const cfResponse = result as CloudFrontResultResponse;
          const decodedBody = Buffer.from(
            cfResponse.body as string,
            "base64"
          ).toString("utf8");

          expect(decodedBody).toEqual(JSON.stringify({ page: expectedPage }));
          expect(cfResponse.status).toEqual(200);
        }
      );

      it.each`
        path                                                           | expectedUri
        ${"/basepath/_next/data/build-id"}                             | ${"/_next/data/build-id/index.json"}
        ${"/basepath/_next/data/build-id/index.json"}                  | ${"/_next/data/build-id/index.json"}
        ${"/basepath/_next/data/build-id/fallback/not-yet-built.json"} | ${"/_next/data/build-id/fallback/not-yet-built.json"}
      `(
        "serves json data via S3 for SSG path $path",
        async ({ path, expectedUri }) => {
          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net",
            config: { eventType: "origin-request" } as any
          });

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/basepath",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(expectedUri);
        }
      );

      it.each`
        path                                                                | expectedRedirect
        ${"/basepath/_next/data/build-id/"}                                 | ${"/basepath/_next/data/build-id"}
        ${"/basepath/_next/data/build-id/index.json/"}                      | ${"/basepath/_next/data/build-id/index.json"}
        ${"/basepath/_next/data/build-id/customers.json/"}                  | ${"/basepath/_next/data/build-id/customers.json"}
        ${"/basepath/_next/data/build-id/customers/superman.json/"}         | ${"/basepath/_next/data/build-id/customers/superman.json"}
        ${"/basepath/_next/data/build-id/customers/superman/profile.json/"} | ${"/basepath/_next/data/build-id/customers/superman/profile.json"}
      `(
        "data requests always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );
    });

    it("uses default s3 endpoint when bucket region is us-east-1", async () => {
      const event = createCloudFrontEvent({
        uri: trailingSlash ? "/basepath/terms/" : "/basepath/terms",
        host: "mydistribution.cloudfront.net",
        s3Region: "us-east-1"
      });

      const result = await handler(event);

      const request = result as CloudFrontRequest;
      const origin = request.origin as CloudFrontOrigin;

      expect(origin.s3).toEqual(
        expect.objectContaining({
          domainName: "my-bucket.s3.amazonaws.com"
        })
      );
      expect(request.headers.host[0].key).toEqual("host");
      expect(request.headers.host[0].value).toEqual(
        "my-bucket.s3.amazonaws.com"
      );
    });

    it("uses regional endpoint for static page when bucket region is not us-east-1", async () => {
      const event = createCloudFrontEvent({
        uri: trailingSlash ? "/basepath/terms/" : "/basepath/terms",
        host: "mydistribution.cloudfront.net",
        s3DomainName: "my-bucket.s3.amazonaws.com",
        s3Region: "eu-west-1"
      });

      const result = await handler(event);

      const request = result as CloudFrontRequest;
      const origin = request.origin as CloudFrontOrigin;

      expect(origin).toEqual({
        s3: {
          authMethod: "origin-access-identity",
          domainName: "my-bucket.s3.eu-west-1.amazonaws.com",
          path: "/basepath/static-pages/build-id",
          region: "eu-west-1"
        }
      });
      expect(request.uri).toEqual("/terms.html");
      expect(request.headers.host[0].key).toEqual("host");
      expect(request.headers.host[0].value).toEqual(
        "my-bucket.s3.eu-west-1.amazonaws.com"
      );
    });

    it("uses regional endpoint for public asset when bucket region is not us-east-1", async () => {
      const event = createCloudFrontEvent({
        uri: "/basepath/favicon.ico",
        host: "mydistribution.cloudfront.net",
        s3DomainName: "my-bucket.s3.amazonaws.com",
        s3Region: "eu-west-1"
      });

      const result = await handler(event);

      const request = result as CloudFrontRequest;
      const origin = request.origin as CloudFrontOrigin;

      expect(origin).toEqual({
        s3: {
          authMethod: "origin-access-identity",
          domainName: "my-bucket.s3.eu-west-1.amazonaws.com",
          path: "/basepath/public",
          region: "eu-west-1"
        }
      });
      expect(request.uri).toEqual("/favicon.ico");
      expect(request.headers.host[0].key).toEqual("host");
      expect(request.headers.host[0].value).toEqual(
        "my-bucket.s3.eu-west-1.amazonaws.com"
      );
    });

    describe("404 page", () => {
      it("renders 404 page if request path can't be matched to any page / api routes", async () => {
        const event = createCloudFrontEvent({
          uri: trailingSlash
            ? "/basepath/page/does/not/exist/"
            : "/basepath/page/does/not/exist",
          host: "mydistribution.cloudfront.net"
        });

        const request = (await handler(event)) as CloudFrontRequest;
        expect(request.uri).toEqual("/404.html");
      });

      it("redirects unmatched request path", async () => {
        let path = "/basepath/page/does/not/exist";
        let expectedRedirect;
        if (trailingSlash) {
          expectedRedirect = path + "/";
        } else {
          expectedRedirect = path;
          path += "/";
        }
        await runRedirectTest(path, expectedRedirect, 308);
      });

      // Next.js serves 404 on pages that do not have basepath prefix. It doesn't redirect whether there is trailing slash or not.
      it.each`
        path
        ${"/terms"}
        ${"/not/found"}
        ${"/manifest.json"}
        ${"/terms/"}
        ${"/not/found/"}
        ${"/manifest.json/"}
      `(
        "serves 404 page from S3 for path without basepath prefix: $path",
        async ({ path, expectedPage }) => {
          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/basepath/static-pages/build-id",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual("/404.html");
          expect(request.headers.host[0].key).toEqual("host");
          expect(request.headers.host[0].value).toEqual(
            "my-bucket.s3.amazonaws.com"
          );
        }
      );

      it.each`
        path
        ${"/basepath/_next/data/unmatched"}
      `(
        "returns 404 page if data request can't be matched for path: $path",
        async ({ path }) => {
          const event = createCloudFrontEvent({
            uri: path,
            origin: {
              s3: {
                domainName: "my-bucket.s3.amazonaws.com"
              }
            },
            config: { eventType: "origin-request" } as any
          });

          const request = (await handler(event)) as CloudFrontRequest;
          expect(request.uri).toEqual("/404.html");
        }
      );

      it("404.html should return 404 status after successful S3 Origin response", async () => {
        const event = createCloudFrontEvent({
          uri: "/404.html",
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-response" } as any,
          response: {
            status: "200"
          } as any
        });

        const response = (await handler(event)) as CloudFrontResultResponse;

        expect(response.status).toEqual("404");
      });
    });

    describe("500 page", () => {
      it("renders 500 page if page render has an error", async () => {
        const event = createCloudFrontEvent({
          uri: trailingSlash
            ? "/basepath/erroredPage/"
            : "/basepath/erroredPage",
          host: "mydistribution.cloudfront.net"
        });

        mockPageRequire("pages/_error.js");
        mockPageRequire("pages/erroredPage.js");

        const response = (await handler(event)) as CloudFrontResultResponse;
        const body = response.body as string;
        const decodedBody = Buffer.from(body, "base64").toString("utf8");

        expect(decodedBody).toEqual("pages/_error.js - 500");
        expect(response.status).toEqual(500);
      });
    });

    describe("Custom Redirects", () => {
      if (trailingSlash) {
        it.each`
          path                           | expectedRedirect           | expectedRedirectStatusCode
          ${"/basepath/terms-new/"}      | ${"/basepath/terms/"}      | ${308}
          ${"/basepath/old-blog/abc/"}   | ${"/basepath/news/abc/"}   | ${308}
          ${"/basepath/old-users/1234/"} | ${"/basepath/users/1234/"} | ${307}
          ${"/basepath/external/"}       | ${"https://example.com"}   | ${308}
        `(
          "redirects path $path to $expectedRedirect, expectedRedirectStatusCode: $expectedRedirectStatusCode",
          async ({ path, expectedRedirect, expectedRedirectStatusCode }) => {
            await runRedirectTest(
              path,
              expectedRedirect,
              expectedRedirectStatusCode
            );
          }
        );
      } else {
        it.each`
          path                          | expectedRedirect          | expectedRedirectStatusCode
          ${"/basepath/terms-new"}      | ${"/basepath/terms"}      | ${308}
          ${"/basepath/old-blog/abc"}   | ${"/basepath/news/abc"}   | ${308}
          ${"/basepath/old-users/1234"} | ${"/basepath/users/1234"} | ${307}
          ${"/basepath/external"}       | ${"https://example.com"}  | ${308}
        `(
          "redirects path $path to $expectedRedirect, expectedRedirectStatusCode: $expectedRedirectStatusCode",
          async ({ path, expectedRedirect, expectedRedirectStatusCode }) => {
            await runRedirectTest(
              path,
              expectedRedirect,
              expectedRedirectStatusCode
            );
          }
        );
      }
    });

    describe("Domain Redirects", () => {
      it.each`
        path                 | querystring | expectedRedirect                              | expectedRedirectStatusCode
        ${"/basepath/"}      | ${""}       | ${"https://www.example.com/basepath/"}        | ${308}
        ${"/basepath/"}      | ${"a=1234"} | ${"https://www.example.com/basepath/?a=1234"} | ${308}
        ${"/basepath/terms"} | ${""}       | ${"https://www.example.com/basepath/terms"}   | ${308}
      `(
        "redirects path $path to $expectedRedirect, expectedRedirectStatusCode: $expectedRedirectStatusCode",
        async ({
          path,
          querystring,
          expectedRedirect,
          expectedRedirectStatusCode
        }) => {
          await runRedirectTest(
            path,
            expectedRedirect,
            expectedRedirectStatusCode,
            querystring,
            "example.com" // Override host to test a domain redirect from host example.com -> https://www.example.com
          );
        }
      );
    });

    describe("Custom Rewrites", () => {
      it.each`
        path                            | expectedPage
        ${"/basepath/index-rewrite"}    | ${"/index.html"}
        ${"/basepath/terms-rewrite"}    | ${"/terms.html"}
        ${"/basepath/path-rewrite/123"} | ${"/terms.html"}
        ${"/basepath/terms"}            | ${"/terms.html"}
      `(
        "serves page $expectedPage from S3 for rewritten path $path",
        async ({ path, expectedPage }) => {
          // If trailingSlash = true, append "/" to get the non-redirected path
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/basepath/static-pages/build-id",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(expectedPage);
          expect(request.headers.host[0].key).toEqual("host");
          expect(request.headers.host[0].value).toEqual(
            "my-bucket.s3.amazonaws.com"
          );
        }
      );
    });

    describe("Custom Headers", () => {
      it.each`
        path                             | expectedHeaders                    | expectedPage
        ${"/basepath/customers/another"} | ${{ "x-custom-header": "custom" }} | ${"pages/customers/[customer].js"}
      `(
        "has custom headers $expectedHeaders and expectedPage $expectedPage for path $path",
        async ({ path, expectedHeaders, expectedPage }) => {
          // If trailingSlash = true, append "/" to get the non-redirected path
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          mockPageRequire(expectedPage);

          const response = await handler(event);

          for (const header in expectedHeaders) {
            const headerEntry = response.headers[header][0];
            expect(headerEntry).toEqual({
              key: header,
              value: expectedHeaders[header]
            });
          }
        }
      );
    });
  });
});
