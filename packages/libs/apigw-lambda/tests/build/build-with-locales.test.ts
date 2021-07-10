import { join } from "path";
import fse from "fs-extra";
import execa from "execa";
import Builder, { ASSETS_DIR } from "../../src/build";
import { DEFAULT_LAMBDA_CODE_DIR } from "../../src/build";
import { cleanupDir, removeNewLineChars } from "../test-utils";
import { BuildManifest } from "../../src/types";

jest.mock("execa");

describe("Builder Tests (with locales)", () => {
  let fseRemoveSpy: jest.SpyInstance;
  let fseEmptyDirSpy: jest.SpyInstance;
  let defaultBuildManifest: BuildManifest;

  const fixturePath = join(__dirname, "./simple-app-fixture-with-locales");
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
        pages: { dynamic, ssr, ssg, html },
        trailingSlash
      } = defaultBuildManifest;

      expect(removeNewLineChars(buildId)).toEqual("test-build-id");

      expect(dynamic).toEqual([
        {
          regex: "^\\/en\\/blog(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/en/blog/[post]"
        },
        {
          regex: "^\\/en\\/customers(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/en/customers/[customer]"
        },
        {
          regex: "^\\/en\\/customers(?:\\/([^\\/#\\?]+?))\\/profile[\\/#\\?]?$",
          route: "/en/customers/[customer]/profile"
        },
        {
          regex:
            "^\\/en\\/customers(?:\\/([^\\/#\\?]+?))(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/en/customers/[customer]/[post]"
        },
        {
          regex:
            "^\\/en\\/customers(?:\\/((?:[^\\/#\\?]+?)(?:\\/(?:[^\\/#\\?]+?))*))?[\\/#\\?]?$",
          route: "/en/customers/[...catchAll]"
        },
        {
          regex: "^\\/en(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/en/[root]"
        },
        {
          regex: "^\\/nl\\/blog(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/nl/blog/[post]"
        },
        {
          regex: "^\\/nl\\/customers(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/nl/customers/[customer]"
        },
        {
          regex: "^\\/nl\\/customers(?:\\/([^\\/#\\?]+?))\\/profile[\\/#\\?]?$",
          route: "/nl/customers/[customer]/profile"
        },
        {
          regex:
            "^\\/nl\\/customers(?:\\/([^\\/#\\?]+?))(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/nl/customers/[customer]/[post]"
        },
        {
          regex:
            "^\\/nl\\/customers(?:\\/((?:[^\\/#\\?]+?)(?:\\/(?:[^\\/#\\?]+?))*))?[\\/#\\?]?$",
          route: "/nl/customers/[...catchAll]"
        },
        {
          regex: "^\\/nl(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
          route: "/nl/[root]"
        }
      ]);

      expect(ssr).toEqual({
        dynamic: {
          "/en/[root]": "pages/[root].js",
          "/en/customers/[...catchAll]": "pages/customers/[...catchAll].js",
          "/en/customers/[customer]": "pages/customers/[customer].js",
          "/en/customers/[customer]/[post]":
            "pages/customers/[customer]/[post].js",
          "/en/customers/[customer]/profile":
            "pages/customers/[customer]/profile.js",
          "/nl/[root]": "pages/[root].js",
          "/nl/customers/[...catchAll]": "pages/customers/[...catchAll].js",
          "/nl/customers/[customer]": "pages/customers/[customer].js",
          "/nl/customers/[customer]/[post]":
            "pages/customers/[customer]/[post].js",
          "/nl/customers/[customer]/profile":
            "pages/customers/[customer]/profile.js"
        },
        nonDynamic: {
          "/en/_app": "pages/_app.js",
          "/en/_document": "pages/_document.js",
          "/en/customers/new": "pages/customers/new.js",
          "/nl/_app": "pages/_app.js",
          "/nl/_document": "pages/_document.js",
          "/nl/customers/new": "pages/customers/new.js"
        }
      });

      expect(html).toEqual({
        nonDynamic: {
          "/en/404": "pages/en/404.html",
          "/en/terms": "pages/en/terms.html",
          "/en/about": "pages/en/about.html",
          "/nl/404": "pages/nl/404.html",
          "/nl/terms": "pages/nl/terms.html",
          "/nl/about": "pages/nl/about.html"
        },
        dynamic: {
          "/en/blog/[post]": "pages/en/blog/[post].html",
          "/nl/blog/[post]": "pages/nl/blog/[post].html"
        }
      });

      expect(ssg).toEqual({
        nonDynamic: {
          "/en": {
            initialRevalidateSeconds: false,
            srcRoute: null
          },
          "/en/contact": {
            initialRevalidateSeconds: false,
            srcRoute: null
          },
          "/nl": {
            initialRevalidateSeconds: false,
            srcRoute: null
          },
          "/nl/contact": {
            initialRevalidateSeconds: false,
            srcRoute: null
          }
        },
        dynamic: {},
        notFound: {}
      });

      expect(publicFiles).toEqual({
        "/favicon.ico": "favicon.ico",
        "/sub/image.png": "sub/image.png",
        "/sw.js": "sw.js"
      });

      expect(trailingSlash).toBe(false);
    });
  });

  describe("Default Handler", () => {
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
      expect(pages).not.toContain([
        "blog.json",
        "nl.json",
        "contact.json",
        "en.json"
      ]);
      expect(pages).not.toContain([
        "about.html",
        "terms.html",
        "contact.html",
        "en.html",
        "nl.html"
      ]);

      // JS files used only for prerendering at build time (contact.js, index.js) are not included since there are no API routes
      expect(pages).not.toContain(["contact.js", "index.js"]);

      // Default lambda has locale directories "en", "nl" but they are empty for now
      expect(pages).toEqual(["_error.js", "customers", "en", "nl"]);
      expect(customerPages).toEqual(["[...catchAll].js"]);
    });
  });

  describe("Assets", () => {
    it("copies locale-specific asset files", async () => {
      expect.assertions(9);
      // Root
      const nextDataFiles = await fse.readdir(
        join(outputDir, `${ASSETS_DIR}/_next/data/test-build-id`)
      );
      expect(nextDataFiles).toEqual(["en", "en.json", "nl", "nl.json"]);

      // English
      const enNextDataFiles = await fse.readdir(
        join(outputDir, `${ASSETS_DIR}/_next/data/test-build-id/en`)
      );
      expect(enNextDataFiles).toEqual(["contact.json"]);

      const enContactJson = await fse.readFile(
        join(
          outputDir,
          `${ASSETS_DIR}/_next/data/test-build-id/en/contact.json`
        ),
        "utf8"
      );
      expect(enContactJson).toBe('"en"');

      const enPageFiles = await fse.readdir(
        join(outputDir, `${ASSETS_DIR}/static-pages/test-build-id/en`)
      );
      expect(enPageFiles).toEqual(["about.html", "contact.html", "terms.html"]);

      const enIndexHtml = await fse.readFile(
        join(outputDir, `${ASSETS_DIR}/static-pages/test-build-id/en.html`),
        "utf8"
      );
      expect(enIndexHtml).toBe("en");

      // Dutch
      const nlNextDataFiles = await fse.readdir(
        join(outputDir, `${ASSETS_DIR}/_next/data/test-build-id/nl`)
      );
      expect(nlNextDataFiles).toEqual(["contact.json"]);

      const nlContactJson = await fse.readFile(
        join(
          outputDir,
          `${ASSETS_DIR}/_next/data/test-build-id/nl/contact.json`
        ),
        "utf8"
      );
      expect(nlContactJson).toBe('"nl"');

      const nlPageFiles = await fse.readdir(
        join(outputDir, `${ASSETS_DIR}/static-pages/test-build-id/nl`)
      );
      expect(nlPageFiles).toEqual(["about.html", "contact.html", "terms.html"]);

      const nlIndexHtml = await fse.readFile(
        join(
          outputDir,
          `${ASSETS_DIR}/static-pages/test-build-id/nl/contact.html`
        ),
        "utf8"
      );
      expect(nlIndexHtml).toBe("nl");
    });
  });
});
