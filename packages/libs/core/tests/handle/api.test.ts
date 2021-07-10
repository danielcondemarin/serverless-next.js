import { PrerenderManifest } from "next/dist/build";
import {
  ApiManifest,
  handleApi,
  prepareBuildManifests,
  RoutesManifest
} from "../../src";
import { mockEvent } from "./utils";

describe("Api handler", () => {
  let pagesManifest: { [key: string]: string };
  let manifest: ApiManifest;
  let routesManifest: RoutesManifest;
  let getPage: any;

  beforeAll(async () => {
    const prerenderManifest: PrerenderManifest = {
      version: 3,
      notFoundRoutes: [],
      routes: {},
      dynamicRoutes: {},
      preview: {
        previewModeId: "test-id",
        previewModeEncryptionKey: "test-key",
        previewModeSigningKey: "test-sig-key"
      }
    };
    routesManifest = {
      basePath: "",
      headers: [
        {
          source: "/api/static",
          headers: [
            {
              key: "X-Test-Header",
              value: "value"
            }
          ]
        }
      ],
      redirects: [
        {
          source: "/api/redirect-simple",
          destination: "/api/static",
          statusCode: 307
        },
        {
          source: "/redirect/:dynamic",
          destination: "/api/dynamic/:dynamic",
          statusCode: 308
        },
        {
          source: "/api/redirect-query",
          destination: "/api/static?foo=bar",
          statusCode: 307
        }
      ],
      rewrites: [
        {
          source: "/rewrite",
          destination: "/api/static"
        },
        {
          source: "/rewrite-not-found",
          destination: "/api/not/found"
        },
        {
          source: "/rewrite/:slug",
          destination: "/api/dynamic/:slug"
        },
        {
          source: "/rewrite-query/:slug",
          destination: "/api/static"
        },
        {
          source: "/rewrite-external",
          destination: "https://ext.example.com"
        }
      ]
    };
    pagesManifest = {
      "/": "pages/index.html",
      "/404": "pages/404.html",
      "/500": "pages/500.html",
      "/api": "pages/api/index.js",
      "/api/static": "pages/api/static.js",
      "/api/dynamic/[id]": "pages/api/dynamic/[id].js"
    };
    const buildId = "test-build-id";
    const publicFiles = ["favicon.ico", "name with spaces.txt"];
    const manifests = await prepareBuildManifests(
      {
        buildId,
        domainRedirects: { "www.example.com": "https://example.com" }
      },
      {},
      routesManifest,
      pagesManifest,
      prerenderManifest,
      publicFiles
    );
    manifest = manifests.apiManifest;
  });

  beforeEach(() => {
    jest.spyOn(console, "error").mockReturnValueOnce();
    getPage = jest.fn();
    getPage.mockReturnValueOnce({ default: jest.fn() });
  });

  describe("Api pages", () => {
    it.each`
      uri                   | page
      ${"/api"}             | ${"pages/api/index.js"}
      ${"/api/static"}      | ${"pages/api/static.js"}
      ${"/api/dynamic/1"}   | ${"pages/api/dynamic/[id].js"}
      ${"/rewrite"}         | ${"pages/api/static.js"}
      ${"/rewrite/2"}       | ${"pages/api/dynamic/[id].js"}
      ${"/rewrite-query/3"} | ${"pages/api/static.js"}
    `("Routes api request $uri to page $page", async ({ uri, page }) => {
      const route = await handleApi(
        mockEvent(uri),
        manifest,
        routesManifest,
        getPage
      );

      expect(route).toBe(true);
      expect(getPage).toHaveBeenCalledWith(page);
    });

    it.each`
      uri
      ${"/api/notfound"}
      ${"/api/dynamic/not/found"}
      ${"/rewrite-not-found"}
    `("Returns false for not-found $uri", async ({ uri }) => {
      const event = mockEvent(uri);
      const route = await handleApi(event, manifest, routesManifest, getPage);

      expect(route).toBeFalsy();
    });
  });

  describe("Headers", () => {
    it.each`
      uri
      ${"/api/static"}
    `("Sets headers for $uri", async ({ uri }) => {
      const event = mockEvent(uri);

      await handleApi(event, manifest, routesManifest, getPage);

      expect(event.res.setHeader).toHaveBeenCalledWith(
        "X-Test-Header",
        "value"
      );
    });
  });

  describe("Redirects", () => {
    it.each`
      uri                              | code   | destination
      ${"/api/redirect-simple"}        | ${307} | ${"/api/static"}
      ${"/redirect/test"}              | ${308} | ${"/api/dynamic/test"}
      ${"/api/redirect-query?key=val"} | ${307} | ${"/api/static?key=val&foo=bar"}
    `(
      "Redirects $uri to $destination with code $code",
      async ({ code, destination, uri }) => {
        const event = mockEvent(uri);
        const route = await handleApi(event, manifest, routesManifest, getPage);

        expect(route).toBe(true);
        expect(event.res.statusCode).toEqual(code);
        expect(event.res.setHeader).toHaveBeenCalledWith("Location", destination);
        expect(event.res.end).toHaveBeenCalled();
      }
    );

    it.each`
      uri              | code   | destination
      ${"/api"}        | ${308} | ${"https://example.com/api"}
      ${"/api/static"} | ${308} | ${"https://example.com/api/static"}
      ${"/api?query"}  | ${308} | ${"https://example.com/api?query"}
    `(
      "Redirects www.example.com$uri to $destination with code $code",
      async ({ code, destination, uri }) => {
        const event = mockEvent(uri, { Host: "www.example.com" });
        const route = await handleApi(event, manifest, routesManifest, getPage);

        expect(route).toBe(true);
        expect(event.res.statusCode).toEqual(code);
        expect(event.res.setHeader).toHaveBeenCalledWith("Location", destination);
        expect(event.res.end).toHaveBeenCalled();
      }
    );
  });

  describe("External rewrite", () => {
    it.each`
      uri                    | path
      ${"/rewrite-external"} | ${"https://ext.example.com"}
    `("Returns external rewrite from $uri to $path", async ({ path, uri }) => {
      const event = mockEvent(uri);
      const route = await handleApi(event, manifest, routesManifest, getPage);

      expect(route).toBeTruthy();
      if (route) {
        expect(route.isExternal).toBeTruthy();
        expect((route as any).path).toEqual(path);
      }
    });
  });
});
