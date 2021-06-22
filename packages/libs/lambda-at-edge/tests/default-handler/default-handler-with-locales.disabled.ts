import { createCloudFrontEvent } from "../test-utils";
import {
  CloudFrontRequest,
  CloudFrontResultResponse,
  CloudFrontOrigin
} from "aws-lambda";
import { runRedirectTestWithHandler } from "../utils/runRedirectTest";

jest.mock("node-fetch", () => require("fetch-mock-jest").sandbox());

const previewToken =
  "eyJhbGciOiJIUzI1NiJ9.dGVzdA.bi6AtyJgYL7FimOTVSoV6Htx9XNLe2PINsOadEDYmwI";

jest.mock(
  "../../src/prerender-manifest.json",
  () => require("./prerender-manifest.json"),
  {
    virtual: true
  }
);

jest.mock(
  "../../src/images-manifest.json",
  () => require("./images-manifest.json"),
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
          () =>
            require("./default-build-manifest-with-locales-with-trailing-slash.json"),
          {
            virtual: true
          }
        );

        // Note that default trailing slash redirects have already been removed from routes-manifest.json (done in deploy step in real app)
        jest.mock(
          "../../src/routes-manifest.json",
          () =>
            require("./default-routes-manifest-with-locales-with-trailing-slash.json"),
          {
            virtual: true
          }
        );
      } else {
        jest.mock(
          "../../src/manifest.json",
          () => require("./default-build-manifest-with-locales.json"),
          {
            virtual: true
          }
        );

        // Note that default trailing slash redirects have already been removed from routes-manifest.json (done in deploy step in real app)
        jest.mock(
          "../../src/routes-manifest.json",
          () => require("./default-routes-manifest-with-locales.json"),
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
        path                                     | expectedPage
        ${"/"}                                   | ${"/en.html"}
        ${"/en"}                                 | ${"/en.html"}
        ${"/nl"}                                 | ${"/nl.html"}
        ${"/en/terms"}                           | ${"/en/terms.html"}
        ${"/en/users/batman"}                    | ${"/en/users/[...user].html"}
        ${"/en/users/test/catch/all"}            | ${"/en/users/[...user].html"}
        ${"/en/no-fallback/example-static-page"} | ${"/en/no-fallback/example-static-page.html"}
        ${"/en/fallback/not-yet-built"}          | ${"/en/fallback/not-yet-built.html"}
        ${"/nl/preview"}                         | ${"/nl/preview.html"}
        ${"/nl/terms"}                           | ${"/nl/terms.html"}
        ${"/nl/users/batman"}                    | ${"/nl/users/[...user].html"}
        ${"/nl/users/test/catch/all"}            | ${"/nl/users/[...user].html"}
        ${"/nl/no-fallback/example-static-page"} | ${"/nl/no-fallback/example-static-page.html"}
        ${"/nl/fallback/not-yet-built"}          | ${"/nl/fallback/not-yet-built.html"}
        ${"/nl/preview"}                         | ${"/nl/preview.html"}
      `(
        "serves page $expectedPage from S3 for path $path",
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
              path: "/static-pages/build-id",
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
        ${"/terms"}
        ${"/users/batman"}
        ${"/users/test/catch/all"}
        ${"/john/123"}
        ${"/no-fallback/example-static-page"}
        ${"/fallback/not-yet-built"}
        ${"/preview"}
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
          uri: "/en/terms.html",
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-response" } as any,
          response: {
            status: "200"
          } as any
        });

        const response = (await handler(event)) as CloudFrontResultResponse;

        expect(response.status).toEqual("200");
      });

      it("handles preview mode", async () => {
        const event = createCloudFrontEvent({
          uri: `/preview${trailingSlash ? "/" : ""}`,
          host: "mydistribution.cloudfront.net",
          requestHeaders: {
            cookie: [
              {
                key: "Cookie",
                value: `__next_preview_data=${previewToken}; __prerender_bypass=def`
              }
            ]
          }
        });

        mockPageRequire("pages/preview.js");
        const result = await handler(event);
        const response = result as CloudFrontResultResponse;
        const decodedBody = Buffer.from(
          response.body as string,
          "base64"
        ).toString("utf8");
        expect(decodedBody).toBe("pages/preview.js");
        expect(response.status).toBe(200);
      });

      it("HTML page without any props served from S3 on preview mode", async () => {
        const event = createCloudFrontEvent({
          uri: `/terms${trailingSlash ? "/" : ""}`,
          host: "mydistribution.cloudfront.net",
          requestHeaders: {
            cookie: [
              {
                key: "Cookie",
                value: `__next_preview_data=${previewToken}; __prerender_bypass=def`
              }
            ]
          }
        });

        const result = await handler(event);

        const request = result as CloudFrontRequest;

        expect(request.origin).toEqual({
          s3: {
            authMethod: "origin-access-identity",
            domainName: "my-bucket.s3.amazonaws.com",
            path: "/static-pages/build-id",
            region: "us-east-1"
          }
        });
        expect(request.uri).toEqual("/en/terms.html");
        expect(request.headers.host[0].key).toEqual("host");
        expect(request.headers.host[0].value).toEqual(
          "my-bucket.s3.amazonaws.com"
        );
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
              path: "/public",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(path);
        }
      );

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
        path                 | expectedRedirect
        ${"/favicon.ico/"}   | ${"/favicon.ico"}
        ${"/manifest.json/"} | ${"/manifest.json"}
      `(
        "public files always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );
    });

    describe("SSR pages routing", () => {
      it.each`
        path                                 | expectedPage
        ${"/abc"}                            | ${"pages/[root].js"}
        ${"/blog/foo"}                       | ${"pages/blog/[id].js"}
        ${"/customers"}                      | ${"pages/customers.js"}
        ${"/customers/superman"}             | ${"pages/customers/[customer].js"}
        ${"/customers/superman/howtofly"}    | ${"pages/customers/[customer]/[post].js"}
        ${"/customers/superman/profile"}     | ${"pages/customers/[customer]/profile.js"}
        ${"/customers/test/catch/all"}       | ${"pages/customers/[...catchAll].js"}
        ${"/nl/abc"}                         | ${"pages/[root].js"}
        ${"/nl/blog/foo"}                    | ${"pages/blog/[id].js"}
        ${"/nl/customers"}                   | ${"pages/customers.js"}
        ${"/nl/customers/superman"}          | ${"pages/customers/[customer].js"}
        ${"/nl/customers/superman/howtofly"} | ${"pages/customers/[customer]/[post].js"}
        ${"/nl/customers/superman/profile"}  | ${"pages/customers/[customer]/profile.js"}
        ${"/nl/customers/test/catch/all"}    | ${"pages/customers/[...catchAll].js"}
      `(
        "renders page $expectedPage for path $path",
        async ({ path, expectedPage }) => {
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
        ${"/abc"}
        ${"/blog/foo"}
        ${"/customers"}
        ${"/customers/superman"}
        ${"/customers/superman/howtofly"}
        ${"/customers/superman/profile"}
        ${"/customers/test/catch/all"}
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
        ${"/abc"}
        ${"/blog/foo"}
        ${"/customers"}
        ${"/customers/superman"}
        ${"/customers/superman/howtofly"}
        ${"/customers/superman/profile"}
        ${"/customers/test/catch/all"}
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
        path                                                         | expectedPage
        ${"/_next/data/build-id/en/customers.json"}                  | ${"pages/customers.js"}
        ${"/_next/data/build-id/en/customers/superman.json"}         | ${"pages/customers/[customer].js"}
        ${"/_next/data/build-id/en/customers/superman/profile.json"} | ${"pages/customers/[customer]/profile.js"}
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
        path                                                     | expectedPage
        ${"/_next/data/build-id/en.json"}                        | ${"pages/index.js"}
        ${"/_next/data/build-id/nl.json"}                        | ${"pages/index.js"}
        ${"/_next/data/build-id/en/fallback/not-yet-built.json"} | ${"pages/fallback/not-yet-built.json"}
      `(
        "serves json data via S3 for SSG path $path",
        async ({ path, expectedPage }) => {
          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net",
            config: { eventType: "origin-request" } as any
          });

          mockPageRequire(expectedPage);

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(path);
        }
      );

      it.each`
        path                                                       | expectedRedirect
        ${"/_next/data/build-id/"}                                 | ${"/_next/data/build-id"}
        ${"/_next/data/build-id/en.json/"}                         | ${"/_next/data/build-id/en.json"}
        ${"/_next/data/build-id/customers.json/"}                  | ${"/_next/data/build-id/customers.json"}
        ${"/_next/data/build-id/customers/superman.json/"}         | ${"/_next/data/build-id/customers/superman.json"}
        ${"/_next/data/build-id/customers/superman/profile.json/"} | ${"/_next/data/build-id/customers/superman/profile.json"}
      `(
        "data requests always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect, 308);
        }
      );

      it("handles preview mode", async () => {
        const event = createCloudFrontEvent({
          uri: "/_next/data/build-id/en/preview.json",
          host: "mydistribution.cloudfront.net",
          requestHeaders: {
            cookie: [
              {
                key: "Cookie",
                value: `__next_preview_data=${previewToken}; __prerender_bypass=def`
              }
            ]
          }
        });

        mockPageRequire("/pages/preview.js");
        const result = await handler(event);
        const response = result as CloudFrontResultResponse;
        const decodedBody = Buffer.from(
          response.body as string,
          "base64"
        ).toString("utf8");
        expect(decodedBody).toBe(
          JSON.stringify({
            page: "pages/preview.js"
          })
        );
        expect(response.status).toBe(200);
      });
    });

    it("uses default s3 endpoint when bucket region is us-east-1", async () => {
      const event = createCloudFrontEvent({
        uri: trailingSlash ? "/terms/" : "/terms",
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
        uri: trailingSlash ? "/terms/" : "/terms",
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
          path: "/static-pages/build-id",
          region: "eu-west-1"
        }
      });
      expect(request.uri).toEqual("/en/terms.html");
      expect(request.headers.host[0].key).toEqual("host");
      expect(request.headers.host[0].value).toEqual(
        "my-bucket.s3.eu-west-1.amazonaws.com"
      );
    });

    it("uses regional endpoint for public asset when bucket region is not us-east-1", async () => {
      const event = createCloudFrontEvent({
        uri: "/favicon.ico",
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
          path: "/public",
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
      it("renders static 404 page if request path can't be matched to any page / api routes", async () => {
        const event = createCloudFrontEvent({
          uri: trailingSlash ? "/page/does/not/exist/" : "/page/does/not/exist",
          host: "mydistribution.cloudfront.net"
        });

        const request = (await handler(event)) as CloudFrontRequest;
        expect(request.origin).toEqual({
          s3: {
            authMethod: "origin-access-identity",
            domainName: "my-bucket.s3.amazonaws.com",
            path: "/static-pages/build-id",
            region: "us-east-1"
          }
        });
        expect(request.uri).toEqual("/en/404.html");
        expect(request.headers.host[0].key).toEqual("host");
        expect(request.headers.host[0].value).toEqual(
          "my-bucket.s3.amazonaws.com"
        );
      });

      it("redirects unmatched request path", async () => {
        let path = "/page/does/not/exist";
        let expectedRedirect;
        if (trailingSlash) {
          expectedRedirect = path + "/";
        } else {
          expectedRedirect = path;
          path += "/";
        }
        await runRedirectTest(path, expectedRedirect, 308);
      });

      it.each`
        path
        ${"/_next/data/unmatched"}
      `(
        "renders static 404 page if data request can't be matched for path: $path",
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
          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/static-pages/build-id",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual("/en/404.html");
          expect(request.headers.host[0].key).toEqual("host");
          expect(request.headers.host[0].value).toEqual(
            "my-bucket.s3.amazonaws.com"
          );
        }
      );

      it("404.html should return 404 status after successful S3 Origin response", async () => {
        const event = createCloudFrontEvent({
          uri: "/en/404.html",
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
      it("renders static 500 page if page render has an error", async () => {
        const event = createCloudFrontEvent({
          uri: trailingSlash ? "/erroredPage/" : "/erroredPage",
          host: "mydistribution.cloudfront.net"
        });

        mockPageRequire("pages/erroredPage.js");

        const request = (await handler(event)) as CloudFrontRequest;
        expect(request.origin).toEqual({
          s3: {
            authMethod: "origin-access-identity",
            domainName: "my-bucket.s3.amazonaws.com",
            path: "/static-pages/build-id",
            region: "us-east-1"
          }
        });
        expect(request.uri).toEqual("/en/500.html");
        expect(request.headers.host[0].key).toEqual("host");
        expect(request.headers.host[0].value).toEqual(
          "my-bucket.s3.amazonaws.com"
        );
      });

      it("500.html should return 500 status after successful S3 Origin response", async () => {
        const event = createCloudFrontEvent({
          uri: "/en/500.html",
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-response" } as any,
          response: {
            status: "200"
          } as any
        });

        const response = (await handler(event)) as CloudFrontResultResponse;

        expect(response.status).toEqual("500");

        // 500 page should never be cached
        expect(response.headers).toEqual({
          "cache-control": [
            {
              key: "Cache-Control",
              value: "public, max-age=0, s-maxage=0, must-revalidate"
            }
          ]
        });
      });
    });

    describe("Custom Redirects", () => {
      if (trailingSlash) {
        it.each`
          uri                                  | expectedRedirect         | expectedRedirectStatusCode
          ${"/terms-new/"}                     | ${"/terms/"}             | ${308}
          ${"/old-blog/abc/"}                  | ${"/news/abc/"}          | ${308}
          ${"/old-users/1234/"}                | ${"/users/1234/"}        | ${307}
          ${"/external/"}                      | ${"https://example.com"} | ${308}
          ${"/terms-redirect-dest-query/"}     | ${"/terms/?foo=bar"}     | ${308}
          ${"/terms-redirect-dest-query/?a=b"} | ${"/terms/?a=b&foo=bar"} | ${308}
        `(
          "redirects path $uri to $expectedRedirect, expectedRedirectStatusCode: $expectedRedirectStatusCode",
          async ({ uri, expectedRedirect, expectedRedirectStatusCode }) => {
            const [path, querystring] = uri.split("?");

            await runRedirectTest(
              path,
              expectedRedirect,
              expectedRedirectStatusCode,
              querystring
            );
          }
        );
      } else {
        it.each`
          uri                                 | expectedRedirect         | expectedRedirectStatusCode
          ${"/terms-new"}                     | ${"/terms"}              | ${308}
          ${"/old-blog/abc"}                  | ${"/news/abc"}           | ${308}
          ${"/old-users/1234"}                | ${"/users/1234"}         | ${307}
          ${"/external"}                      | ${"https://example.com"} | ${308}
          ${"/terms-redirect-dest-query"}     | ${"/terms?foo=bar"}      | ${308}
          ${"/terms-redirect-dest-query?a=b"} | ${"/terms?a=b&foo=bar"}  | ${308}
        `(
          "redirects path $uri to $expectedRedirect, expectedRedirectStatusCode: $expectedRedirectStatusCode",
          async ({ uri, expectedRedirect, expectedRedirectStatusCode }) => {
            const [path, querystring] = uri.split("?");

            await runRedirectTest(
              path,
              expectedRedirect,
              expectedRedirectStatusCode,
              querystring
            );
          }
        );
      }
    });

    describe("Domain Redirects", () => {
      it.each`
        path        | querystring | expectedRedirect                     | expectedRedirectStatusCode
        ${"/"}      | ${""}       | ${"https://www.example.com/"}        | ${308}
        ${"/"}      | ${"a=1234"} | ${"https://www.example.com/?a=1234"} | ${308}
        ${"/terms"} | ${""}       | ${"https://www.example.com/terms"}   | ${308}
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
        uri                                | expectedPage        | expectedQuerystring
        ${"/index-rewrite"}                | ${"/en.html"}       | ${""}
        ${"/terms-rewrite"}                | ${"/en/terms.html"} | ${""}
        ${"/path-rewrite/123"}             | ${"/en/terms.html"} | ${"slug=123"}
        ${"/terms"}                        | ${"/en/terms.html"} | ${""}
        ${"/terms-rewrite-dest-query"}     | ${"/en/terms.html"} | ${"foo=bar"}
        ${"/terms-rewrite-dest-query?a=b"} | ${"/en/terms.html"} | ${"a=b&foo=bar"}
      `(
        "serves page $expectedPage from S3 for rewritten path $uri",
        async ({ uri, expectedPage, expectedQuerystring }) => {
          let [path, querystring] = uri.split("?");

          // If trailingSlash = true, append "/" to get the non-redirected path
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            querystring: querystring,
            host: "mydistribution.cloudfront.net"
          });

          const result = await handler(event);

          const request = result as CloudFrontRequest;

          expect(request.origin).toEqual({
            s3: {
              authMethod: "origin-access-identity",
              domainName: "my-bucket.s3.amazonaws.com",
              path: "/static-pages/build-id",
              region: "us-east-1"
            }
          });
          expect(request.uri).toEqual(expectedPage);
          expect(request.querystring).toEqual(expectedQuerystring);
          expect(request.headers.host[0].key).toEqual("host");
          expect(request.headers.host[0].value).toEqual(
            "my-bucket.s3.amazonaws.com"
          );
        }
      );

      it.each`
        uri                    | rewriteUri                | method
        ${"/external-rewrite"} | ${"https://external.com"} | ${"GET"}
        ${"/external-rewrite"} | ${"https://external.com"} | ${"POST"}
      `(
        "serves external rewrite $rewriteUri for rewritten path $uri and method $method",
        async ({ uri, rewriteUri, method }) => {
          const { default: fetchMock } = await import("node-fetch");

          const mockFetchResponse = {
            body: "external",
            headers: {
              "Content-Type": "text/plain",
              Host: "external.com",
              "x-amz-cf-pop": "SEA19-C1"
            }, // host and x-amz-cf-pop header are blacklisted and won't be added
            status: 200
          };

          fetchMock.mock(rewriteUri, mockFetchResponse);

          let [path, querystring] = uri.split("?");

          // If trailingSlash = true, append "/" to get the non-redirected path
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
          }

          const event = createCloudFrontEvent({
            uri: path,
            querystring: querystring,
            host: "mydistribution.cloudfront.net",
            method: method,
            body:
              method === "POST"
                ? {
                    action: "read-only",
                    data: "eyJhIjoiYiJ9",
                    encoding: "base64",
                    inputTruncated: false
                  }
                : undefined
          });

          const response: CloudFrontResultResponse = await handler(event);

          expect(response).toEqual({
            body: "ZXh0ZXJuYWw=",
            bodyEncoding: "base64",
            headers: {
              "content-type": [
                {
                  key: "content-type",
                  value: "text/plain"
                }
              ]
            },
            status: 200,
            statusDescription: "OK"
          });

          expect(fetchMock).toHaveLastFetched("https://external.com", {
            method: method
          });

          fetchMock.reset();
        }
      );
    });

    describe("Custom Rewrites pass correct Request URL to page render", () => {
      it.each`
        path                  | expectedPage             | expectedUrl
        ${"/promise-page"}    | ${"pages/async-page.js"} | ${"/en/promise-page"}
        ${"/en/promise-page"} | ${"pages/async-page.js"} | ${"/en/promise-page"}
        ${"/nl/promise-page"} | ${"pages/async-page.js"} | ${"/nl/promise-page"}
      `(
        "serves page $expectedPage for rewritten path $path with correct request url",
        async ({ path, expectedPage, expectedUrl }) => {
          // If trailingSlash = true, append "/" to get the non-redirected path
          if (trailingSlash && !path.endsWith("/")) {
            path += "/";
            expectedUrl += "/";
          }

          mockPageRequire(expectedPage);
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const page = require(`../../src/${expectedPage}`);
          const event = createCloudFrontEvent({
            uri: path,
            host: "mydistribution.cloudfront.net"
          });

          const result = await handler(event);
          const call = page.render.mock.calls[0];
          const firstArgument = call[0];
          expect(firstArgument).toMatchObject({ url: expectedUrl });
          const decodedBody = Buffer.from(
            result.body as string,
            "base64"
          ).toString("utf8");
          expect(decodedBody).toEqual(expectedPage);
        }
      );
    });

    describe("Custom Headers", () => {
      it.each`
        path                    | expectedHeaders                    | expectedPage
        ${"/customers/another"} | ${{ "x-custom-header": "custom" }} | ${"pages/customers/[customer].js"}
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

    describe("Root Locales Redirects", () => {
      it.each`
        acceptLanguageHeader   | expectedRedirect
        ${"nl"}                | ${"/nl"}
        ${"fr,nl,en"}          | ${"/fr"}
        ${"nl,fr"}             | ${"/nl"}
        ${"fr,nl"}             | ${"/fr"}
        ${"de,nl"}             | ${"/nl"}
        ${"fr;q=0.5,de;q=0.8"} | ${"/fr"}
        ${"en;q=0.5,nl;q=0.8"} | ${"/nl"}
      `(
        "redirects path / with accept-language [$acceptLanguageHeader] to $expectedRedirect",
        async ({ acceptLanguageHeader, expectedRedirect }) => {
          if (trailingSlash) {
            expectedRedirect += "/";
          }

          await runRedirectTest(
            "/",
            expectedRedirect,
            307,
            undefined,
            undefined,
            {
              "accept-language": [
                { key: "Accept-Language", value: acceptLanguageHeader }
              ]
            }
          );
        }
      );
    });
  });
});
