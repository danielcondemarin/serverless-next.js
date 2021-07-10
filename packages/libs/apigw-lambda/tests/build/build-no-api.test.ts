import { join } from "path";
import fse from "fs-extra";
import execa from "execa";
import Builder from "../../src/build";
import { DEFAULT_LAMBDA_CODE_DIR } from "../../src/build";
import { cleanupDir, removeNewLineChars } from "../test-utils";
import { BuildManifest } from "../../src/types";

jest.mock("execa");

describe("Builder Tests (no API routes)", () => {
  let fseRemoveSpy: jest.SpyInstance;
  let fseEmptyDirSpy: jest.SpyInstance;
  let defaultBuildManifest: BuildManifest;

  const fixturePath = join(__dirname, "./simple-app-fixture-no-api");
  const outputDir = join(fixturePath, ".test_sls_next_output");

  beforeEach(async () => {
    const mockExeca = execa as jest.Mock;
    mockExeca.mockResolvedValueOnce();

    fseRemoveSpy = jest.spyOn(fse, "remove").mockImplementation(() => {
      return;
    });
    fseEmptyDirSpy = jest.spyOn(fse, "emptyDir");

    const builder = new Builder(fixturePath, outputDir);
    await builder.build();

    defaultBuildManifest = await fse.readJSON(
      join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/manifest.json`)
    );
  });

  afterEach(() => {
    fseEmptyDirSpy.mockRestore();
    fseRemoveSpy.mockRestore();
    return cleanupDir(outputDir);
  });

  describe("Cleanup", () => {
    it(".next directory is emptied except for cache/ folder", () => {
      expect(fseRemoveSpy).toBeCalledWith(
        join(fixturePath, ".next/serverless")
      );
      expect(fseRemoveSpy).toBeCalledWith(
        join(fixturePath, ".next/prerender-manifest.json")
      );
      expect(fseRemoveSpy).not.toBeCalledWith(join(fixturePath, ".next/cache"));
    });

    it("output directory is cleanup before building", () => {
      expect(fseEmptyDirSpy).toBeCalledWith(
        expect.stringContaining(join(".test_sls_next_output", "default-lambda"))
      );
      expect(fseEmptyDirSpy).toBeCalledWith(
        expect.stringContaining(join(".test_sls_next_output", "assets"))
      );
    });
  });

  describe("Default Handler Manifest", () => {
    it("adds full manifest", () => {
      const {
        buildId,
        publicFiles,
        pages: { dynamic, ssg, ssr, html },
        trailingSlash
      } = defaultBuildManifest;

      expect(removeNewLineChars(buildId)).toEqual("test-build-id");

      expect(dynamic).toEqual([
        {
          route: "/blog/[post]",
          regex: "^\\/blog(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$"
        },
        {
          route: "/customers/[customer]",
          regex: "^\\/customers(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$"
        },
        {
          route: "/customers/[customer]/profile",
          regex: "^\\/customers(?:\\/([^\\/#\\?]+?))\\/profile[\\/#\\?]?$"
        },
        {
          route: "/customers/[customer]/[post]",
          regex:
            "^\\/customers(?:\\/([^\\/#\\?]+?))(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$"
        },
        {
          route: "/customers/[...catchAll]",
          regex:
            "^\\/customers(?:\\/((?:[^\\/#\\?]+?)(?:\\/(?:[^\\/#\\?]+?))*))?[\\/#\\?]?$"
        },
        {
          route: "/[root]",
          regex: "^(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$"
        }
      ]);

      expect(ssg).toEqual({
        nonDynamic: {
          "/": {
            initialRevalidateSeconds: false,
            srcRoute: null
          },
          "/contact": {
            initialRevalidateSeconds: false,
            srcRoute: null
          }
        },
        dynamic: {},
        notFound: {}
      });

      expect(ssr).toEqual({
        nonDynamic: {
          "/customers/new": "pages/customers/new.js",
          "/_app": "pages/_app.js",
          "/_document": "pages/_document.js"
        },
        dynamic: {
          "/[root]": "pages/[root].js",
          "/customers/[customer]": "pages/customers/[customer].js",
          "/customers/[customer]/[post]":
            "pages/customers/[customer]/[post].js",
          "/customers/[customer]/profile":
            "pages/customers/[customer]/profile.js",
          "/customers/[...catchAll]": "pages/customers/[...catchAll].js"
        }
      });

      expect(html).toEqual({
        nonDynamic: {
          "/404": "pages/404.html",
          "/terms": "pages/terms.html",
          "/about": "pages/about.html"
        },
        dynamic: {
          "/blog/[post]": "pages/blog/[post].html"
        }
      });

      expect(publicFiles).toEqual({
        "/favicon.ico": "favicon.ico",
        "/sub/image.png": "sub/image.png",
        "/sw.js": "sw.js"
      });

      expect(trailingSlash).toBe(false);
    });
  });

  describe("Default Handler Artefact Files", () => {
    it("copies build files", async () => {
      expect.assertions(7);

      const files = await fse.readdir(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}`)
      );
      const pages = await fse.readdir(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/pages`)
      );
      const customerPages = await fse.readdir(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/pages/customers`)
      );
      const apiDirExists = await fse.pathExists(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/pages/api`)
      );

      expect(files).toEqual(
        expect.arrayContaining([
          "index.js", // there are more chunks but it should at least contain the entry point
          "manifest.json",
          "pages",
          "prerender-manifest.json",
          "routes-manifest.json"
        ])
      );

      // api pages should not be included in the default lambda
      expect(apiDirExists).toEqual(false);

      // HTML Prerendered pages or JSON static props files
      // should not be included in the default lambda
      expect(pages).not.toContain(["blog.json", "index.json", "contact.json"]);
      expect(pages).not.toContain([
        "about.html",
        "terms.html",
        "contact.html",
        "index.html"
      ]);

      // JS files used only for prerendering at build time (contact.js, index.js) are not included since there are no API routes
      expect(pages).not.toContain(["contact.js", "index.js"]);

      expect(pages).toEqual(["_error.js", "customers"]);
      expect(customerPages).toEqual(["[...catchAll].js"]);
    });
  });
});
