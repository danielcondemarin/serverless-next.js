import { createCloudFrontEvent } from "../test-utils";
import {
  CloudFrontRequest,
  CloudFrontResultResponse,
  CloudFrontOrigin
} from "aws-lambda";

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn()
}));

jest.mock(
  "../../src/prerender-manifest.json",
  () => require("./prerender-manifest.json"),
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
  describe.each`
    trailingSlash
    ${false}
    ${true}
  `("Routing with trailingSlash = $trailingSlash", ({ trailingSlash }) => {
    let handler: any;
    let runRedirectTest: (
      path: string,
      expectedRedirect: string,
      querystring?: string
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
      } else {
        jest.mock(
          "../../src/manifest.json",
          () => require("./default-build-manifest.json"),
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
        querystring?: string
      ): Promise<void> => {
        const event = createCloudFrontEvent({
          uri: path,
          host: "mydistribution.cloudfront.net",
          config: { eventType: "origin-request" } as any,
          querystring: querystring
        });

        const result = await handler(event);
        const response = result as CloudFrontResultResponse;

        expect(response.headers).toEqual({
          location: [
            {
              key: "Location",
              value: expectedRedirect
            }
          ],
          refresh: [
            {
              key: "Refresh",
              value: `0;url=${expectedRedirect}`
            }
          ]
        });
        expect(response.status).toEqual("308");
      };
    });

    afterEach(() => {
      jest.unmock("../../src/manifest.json");
    });

    describe("HTML pages routing", () => {
      it.each`
        path                                                  | expectedPage
        ${"/"}                                                | ${"/index.html"}
        ${"/terms"}                                           | ${"/terms.html"}
        ${"/users/batman"}                                    | ${"/users/[user].html"}
        ${"/users/test/catch/all"}                            | ${"/users/[...user].html"}
        ${"/john/123"}                                        | ${"/[username]/[id].html"}
        ${"/tests/prerender-manifest/example-static-page"}    | ${"/tests/prerender-manifest/example-static-page.html"}
        ${"/tests/prerender-manifest-fallback/not-yet-built"} | ${"/tests/prerender-manifest-fallback/not-yet-built.html"}
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
              path: "/static-pages",
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
        ${"/tests/prerender-manifest/example-static-page"}
        ${"/tests/prerender-manifest-fallback/not-yet-built"}
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
          await runRedirectTest(path, expectedRedirect);
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
      
      it("handles preview mode", async () => {
        const event = createCloudFrontEvent({
          uri: "/preview",
          host: "mydistribution.cloudfront.net",
          requestHeaders: {
            cookie: [
              {
                key: "Cookie",
                value: "__next_preview_data=abc; __prerender_bypass=def"
              }
            ]
          }
        });

        if (trailingSlash) {
          await runRedirectTest("/preview", "/preview/");
        } else {
          mockPageRequire("pages/preview.js");
          const result = await handler(event);
          const response = result as CloudFrontResultResponse;
          const decodedBody = new Buffer(
            response.body as string,
            "base64"
          ).toString("utf8");
          expect(decodedBody).toBe("pages/preview.js");
          expect(response.status).toBe(200);
        }
      });
    });

    describe("Public files routing", () => {
      it("serves public file from S3 /public folder", async () => {
        const event = createCloudFrontEvent({
          uri: "/manifest.json",
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
        path                 | expectedRedirect
        ${"/favicon.ico/"}   | ${"/favicon.ico"}
        ${"/manifest.json/"} | ${"/manifest.json"}
      `(
        "public files always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect);
        }
      );
    });

    describe("SSR pages routing", () => {
      it.each`
        path                              | expectedPage
        ${"/abc"}                         | ${"pages/[root].js"}
        ${"/blog/foo"}                    | ${"pages/blog/[id].js"}
        ${"/customers"}                   | ${"pages/customers/index.js"}
        ${"/customers/superman"}          | ${"pages/customers/[customer].js"}
        ${"/customers/superman/howtofly"} | ${"pages/customers/[customer]/[post].js"}
        ${"/customers/superman/profile"}  | ${"pages/customers/[customer]/profile.js"}
        ${"/customers/test/catch/all"}    | ${"pages/customers/[...catchAll].js"}
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
          const decodedBody = new Buffer(
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
          await runRedirectTest(path, expectedRedirect);
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

        await runRedirectTest(path, expectedRedirect, querystring);
      });
    });

    describe("Data Requests", () => {
      it.each`
        path                                                      | expectedPage
        ${"/_next/data/build-id"}                                 | ${"pages/index.js"}
        ${"/_next/data/build-id/index.json"}                      | ${"pages/index.js"}
        ${"/_next/data/build-id/customers.json"}                  | ${"pages/customers/index.js"}
        ${"/_next/data/build-id/customers/superman.json"}         | ${"pages/customers/[customer].js"}
        ${"/_next/data/build-id/customers/superman/profile.json"} | ${"pages/customers/[customer]/profile.js"}
      `("serves json data for path $path", async ({ path, expectedPage }) => {
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
      });

      it.each`
        path                                                       | expectedRedirect
        ${"/_next/data/build-id/"}                                 | ${"/_next/data/build-id"}
        ${"/_next/data/build-id/index.json/"}                      | ${"/_next/data/build-id/index.json"}
        ${"/_next/data/build-id/customers.json/"}                  | ${"/_next/data/build-id/customers.json"}
        ${"/_next/data/build-id/customers/superman.json/"}         | ${"/_next/data/build-id/customers/superman.json"}
        ${"/_next/data/build-id/customers/superman/profile.json/"} | ${"/_next/data/build-id/customers/superman/profile.json"}
      `(
        "data requests always redirect to path without trailing slash: $path -> $expectedRedirect",
        async ({ path, expectedRedirect }) => {
          await runRedirectTest(path, expectedRedirect);
        }
      );

      it("handles preview mode", async () => {
        const event = createCloudFrontEvent({
          uri: "/_next/data/build-id/preview.json",
          host: "mydistribution.cloudfront.net",
          requestHeaders: {
            cookie: [
              {
                key: "Cookie",
                value: "__next_preview_data=abc; __prerender_bypass=def"
              }
            ]
          }
        });

        mockPageRequire("/pages/preview.js");
        const result = await handler(event);
        const response = result as CloudFrontResultResponse;
        const decodedBody = new Buffer(
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
          path: "/static-pages",
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
      it("renders 404 page if request path can't be matched to any page / api routes", async () => {
        const event = createCloudFrontEvent({
          uri: trailingSlash ? "/page/does/not/exist/" : "/page/does/not/exist",
          host: "mydistribution.cloudfront.net"
        });

        mockPageRequire("pages/_error.js");

        const response = (await handler(event)) as CloudFrontResultResponse;
        const body = response.body as string;
        const decodedBody = new Buffer(body, "base64").toString("utf8");

        expect(decodedBody).toEqual("pages/_error.js - 404");
        expect(response.status).toEqual("404");
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
        await runRedirectTest(path, expectedRedirect);
      });

      it.each`
        path
        ${"/_next/data/unmatched"}
      `(
        "renders 404 page if data request can't be matched for path: $path",
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

          mockPageRequire("./pages/_error.js");

          const response = (await handler(event)) as CloudFrontResultResponse;
          const body = response.body as string;
          const decodedBody = new Buffer(body, "base64").toString("utf8");

          expect(decodedBody).toEqual(
            JSON.stringify({
              page: "pages/_error.js - 404"
            })
          );
          expect(response.status).toEqual("404");
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
          uri: trailingSlash ? "/erroredPage/" : "/erroredPage",
          host: "mydistribution.cloudfront.net"
        });

        mockPageRequire("pages/erroredPage.js");
        mockPageRequire("pages/_error.js");

        const response = (await handler(event)) as CloudFrontResultResponse;
        const body = response.body as string;
        const decodedBody = new Buffer(body, "base64").toString("utf8");

        expect(decodedBody).toEqual("pages/_error.js - 500");
        expect(response.status).toEqual("500");
      });
    });
  });
});
