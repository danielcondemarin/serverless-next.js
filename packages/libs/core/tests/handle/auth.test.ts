import { PrerenderManifest } from "next/dist/build";
import {
  ApiManifest,
  handleApi,
  handleDefault,
  PageManifest,
  prepareBuildManifests,
  RoutesManifest
} from "../../src";
import { mockEvent } from "./utils";

const authHeaders = {
  Authorization: "Basic dGVzdC11c2VyOnRlc3QtcGFzcw=="
};

const wrongAuthHeaders = {
  Authorization: "Basic dGVzdC11c2VyOnRlc3QtcGFooo=="
};

describe("Basic authentication", () => {
  let pagesManifest: { [key: string]: string };
  let apiManifest: ApiManifest;
  let pageManifest: PageManifest;
  let prerenderManifest: PrerenderManifest;
  let routesManifest: RoutesManifest;
  let getPage: any;

  beforeAll(async () => {
    prerenderManifest = {
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
      headers: [],
      redirects: [],
      rewrites: []
    };
    pagesManifest = {
      "/": "pages/index.js",
      "/404": "pages/404.html",
      "/500": "pages/500.html",
      "/api": "pages/api/index.js"
    };
    const buildId = "test-build-id";
    const publicFiles = ["favicon.ico"];
    const manifests = await prepareBuildManifests(
      {
        authentication: {
          username: "test-user",
          password: "test-pass"
        },
        buildId,
        domainRedirects: {}
      },
      {},
      routesManifest,
      pagesManifest,
      prerenderManifest,
      publicFiles
    );
    apiManifest = manifests.apiManifest;
    pageManifest = manifests.pageManifest;
  });

  beforeEach(() => {
    jest.spyOn(console, "error").mockReturnValueOnce();
    getPage = jest.fn();
    getPage.mockReturnValueOnce({ default: jest.fn() });
  });

  describe("Api handler", () => {
    it("Handles api request /api when authorized", async () => {
      const route = await handleApi(
        mockEvent("/api", authHeaders),
        apiManifest,
        routesManifest,
        getPage
      );

      expect(route).toBe(true);
      expect(getPage).toHaveBeenCalledWith("pages/api/index.js");
    });

    it("Returns 401 when not authorized", async () => {
      const event = mockEvent("/api");
      const route = await handleApi(
        event,
        apiManifest,
        routesManifest,
        getPage
      );

      expect(route).toBe(true);
      expect(event.res.statusCode).toEqual(401);
    });

    it("Returns 401 when password is wrong", async () => {
      const event = mockEvent("/api", wrongAuthHeaders);
      const route = await handleApi(
        event,
        apiManifest,
        routesManifest,
        getPage
      );

      expect(route).toBe(true);
      expect(event.res.statusCode).toEqual(401);
    });
  });

  describe("Default handler", () => {
    it("Handles page request / when authorized", async () => {
      const route = await handleDefault(
        mockEvent("/", authHeaders),
        pageManifest,
        prerenderManifest,
        routesManifest,
        getPage
      );

      expect(route).toBeTruthy();
      expect(getPage).toHaveBeenCalledWith("pages/index.js");
    });

    it("Returns 401 when not authorized", async () => {
      const event = mockEvent("/");
      const route = await handleDefault(
        event,
        pageManifest,
        prerenderManifest,
        routesManifest,
        getPage
      );

      expect(route).toBeFalsy();
      expect(event.res.statusCode).toEqual(401);
    });

    it("Returns 401 when password is wrong", async () => {
      const event = mockEvent("/", wrongAuthHeaders);
      const route = await handleDefault(
        event,
        pageManifest,
        prerenderManifest,
        routesManifest,
        getPage
      );

      expect(route).toBeFalsy();
      expect(event.res.statusCode).toEqual(401);
    });
  });
});
