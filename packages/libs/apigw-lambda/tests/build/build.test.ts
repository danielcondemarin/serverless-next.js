import { join } from "path";
import fse from "fs-extra";
import execa from "execa";
import Builder, { ASSETS_DIR, DEFAULT_LAMBDA_CODE_DIR } from "../../src/build";
import { cleanupDir, removeNewLineChars } from "../test-utils";
import { BuildManifest } from "../../src/types";

jest.mock("execa");

describe("Builder Tests", () => {
  const countLines = (text: string): number => {
    return text.split(/\r\n|\r|\n/).length;
  };

  let fseRemoveSpy: jest.SpyInstance;
  let fseEmptyDirSpy: jest.SpyInstance;
  let defaultBuildManifest: BuildManifest;

  const fixturePath = join(__dirname, "./simple-app-fixture");
  const outputDir = join(fixturePath, ".test_sls_next_output");

  describe("Regular build", () => {
    beforeEach(async () => {
      const mockExeca = execa as jest.Mock;
      mockExeca.mockResolvedValueOnce();

      fseRemoveSpy = jest.spyOn(fse, "remove").mockImplementation(() => {
        return;
      });
      fseEmptyDirSpy = jest.spyOn(fse, "emptyDir");

      const builder = new Builder(fixturePath, outputDir, {
        domainRedirects: {
          "example.com": "https://www.example.com",
          "another.com": "https://www.another.com/",
          "www.other.com": "https://other.com"
        }
      });
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
        expect(fseRemoveSpy).not.toBeCalledWith(
          join(fixturePath, ".next/cache")
        );
      });

      it("output directory is cleanup before building", () => {
        expect(fseEmptyDirSpy).toBeCalledWith(
          expect.stringContaining(
            join(".test_sls_next_output", "default-lambda")
          )
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
          pages: { dynamic, ssr, html },
          trailingSlash,
          domainRedirects
        } = defaultBuildManifest;

        expect(removeNewLineChars(buildId)).toEqual("test-build-id");

        expect(dynamic).toEqual([
          {
            regex: "^\\/blog(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
            route: "/blog/[post]"
          },
          {
            regex: "^\\/customers(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
            route: "/customers/[customer]"
          },
          {
            regex: "^\\/customers(?:\\/([^\\/#\\?]+?))\\/profile[\\/#\\?]?$",
            route: "/customers/[customer]/profile"
          },
          {
            regex:
              "^\\/customers(?:\\/([^\\/#\\?]+?))(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
            route: "/customers/[customer]/[post]"
          },
          {
            regex:
              "^\\/customers(?:\\/((?:[^\\/#\\?]+?)(?:\\/(?:[^\\/#\\?]+?))*))?[\\/#\\?]?$",
            route: "/customers/[...catchAll]"
          },
          {
            regex:
              "^\\/products(?:\\/((?:[^\\/#\\?]+?)(?:\\/(?:[^\\/#\\?]+?))*))?[\\/#\\?]?$",
            route: "/products/[[...optionalCatchAll]]"
          },
          {
            regex: "^(?:\\/([^\\/#\\?]+?))[\\/#\\?]?$",
            route: "/[root]"
          }
        ]);

        expect(ssr).toEqual({
          dynamic: {
            "/[root]": "pages/[root].js",
            "/customers/[customer]": "pages/customers/[customer].js",
            "/customers/[customer]/[post]":
              "pages/customers/[customer]/[post].js",
            "/customers/[customer]/profile":
              "pages/customers/[customer]/profile.js",
            "/customers/[...catchAll]": "pages/customers/[...catchAll].js",
            "/products/[[...optionalCatchAll]]":
              "pages/products/[[...optionalCatchAll]].js"
          },
          nonDynamic: {
            "/customers/new": "pages/customers/new.js",
            "/": "pages/index.js",
            "/_app": "pages/_app.js",
            "/_document": "pages/_document.js",
            "/products": "pages/products/[[...optionalCatchAll]].js"
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

        expect(domainRedirects).toEqual({
          "example.com": "https://www.example.com",
          "another.com": "https://www.another.com",
          "www.other.com": "https://other.com"
        });
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
        const productPages = await fse.readdir(
          join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/pages/products`)
        );
        const apiPages = await fse.readdir(
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

        // api pages should be included in the default lambda
        expect(apiPages).toEqual(["customers", "customers.js"]);

        // HTML Prerendered pages or JSON static props files
        // should not be included in the default lambda
        expect(pages).not.toContain([
          "blog.json",
          "index.json",
          "contact.json"
        ]);
        expect(pages).not.toContain([
          "about.html",
          "terms.html",
          "contact.html",
          "index.html"
        ]);

        // Note: JS files used only for prerendering at build time (contact.js, index.js) are included since there are API routes
        expect(pages).toEqual([
          "_error.js",
          "api",
          "blog.js",
          "contact.js",
          "customers",
          "index.js",
          "products"
        ]);
        expect(customerPages).toEqual(["[...catchAll].js", "[post].js"]);
        expect(productPages).toEqual(["[[...optionalCatchAll]].js"]);
      });

      it("default handler is not minified", async () => {
        const defaultHandler = await fse.readFile(
          join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/index.js`)
        );

        expect(countLines(defaultHandler.toString())).toBeGreaterThan(10); // Arbitrary choice
      });
    });

    describe("Assets Artefact Files", () => {
      it("copies all assets", async () => {
        const publicFiles = await fse.readdir(
          join(outputDir, `${ASSETS_DIR}/public`)
        );
        expect(publicFiles).toEqual(["favicon.ico", "sub", "sw.js"]);

        const staticFiles = await fse.readdir(
          join(outputDir, `${ASSETS_DIR}/static`)
        );
        expect(staticFiles).toEqual(["donotdelete.txt"]);

        const nextDataFiles = await fse.readdir(
          join(outputDir, `${ASSETS_DIR}/_next/data/test-build-id`)
        );
        expect(nextDataFiles).toEqual(["contact.json", "index.json"]);

        const nextStaticFiles = await fse.readdir(
          join(outputDir, `${ASSETS_DIR}/_next/static`)
        );
        expect(nextStaticFiles).toEqual(["chunks"]);

        const staticPagesFiles = await fse.readdir(
          join(outputDir, `${ASSETS_DIR}/static-pages/test-build-id`)
        );
        expect(staticPagesFiles).toEqual([
          "about.html",
          "contact.html",
          "index.html",
          "terms.html"
        ]);

        // Check BUILD_ID file
        expect(
          (
            await fse.readFile(join(outputDir, `${ASSETS_DIR}/BUILD_ID`))
          ).toString()
        ).toEqual("test-build-id");
      });
    });
  });

  describe("Minified handlers build", () => {
    beforeEach(async () => {
      const mockExeca = execa as jest.Mock;
      mockExeca.mockResolvedValueOnce();

      fseRemoveSpy = jest.spyOn(fse, "remove").mockImplementation(() => {
        return;
      });
      fseEmptyDirSpy = jest.spyOn(fse, "emptyDir");

      const builder = new Builder(fixturePath, outputDir, {
        minifyHandlers: true
      });
      await builder.build();
    });

    it("default handler is minified", async () => {
      const defaultHandler = await fse.readFile(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}/index.js`)
      );

      expect(countLines(defaultHandler.toString())).toEqual(2);
    });
  });

  describe("Build edge cases", () => {
    let builder: Builder;

    beforeEach(async () => {
      const mockExeca = execa as jest.Mock;
      mockExeca.mockResolvedValueOnce();

      fseRemoveSpy = jest.spyOn(fse, "remove").mockImplementation(() => {
        return;
      });
      fseEmptyDirSpy = jest.spyOn(fse, "emptyDir");
    });

    it("fails build when there is a public/static directory that conflicts with static/* behavior", async () => {
      const fixturePath = join(
        __dirname,
        "./simple-app-fixture-public-static-error"
      );
      builder = new Builder(fixturePath, outputDir, {});
      await expect(builder.build()).rejects.toThrow(
        "You cannot have assets in the directory [public/static] as they conflict with the static/* CloudFront cache behavior. Please move these assets into another directory."
      );
    });
  });

  describe("Custom handler", () => {
    let fseRemoveSpy: jest.SpyInstance;
    let fseEmptyDirSpy: jest.SpyInstance;
    const fixturePath = join(__dirname, "./simple-app-fixture");
    const outputDir = join(fixturePath, ".test_sls_next_output");

    beforeEach(async () => {
      const mockExeca = execa as jest.Mock;
      mockExeca.mockResolvedValueOnce();

      fseRemoveSpy = jest
        .spyOn(fse, "remove")
        .mockImplementation(() => undefined);
      fseEmptyDirSpy = jest.spyOn(fse, "emptyDir");
      const builder = new Builder(fixturePath, outputDir, {
        handler: "testFile.js"
      });
      await builder.build();
    });

    afterEach(() => {
      fseEmptyDirSpy.mockRestore();
      fseRemoveSpy.mockRestore();
      return cleanupDir(outputDir);
    });

    it("copies build files", async () => {
      expect.assertions(1);

      const defaultFiles = await fse.readdir(
        join(outputDir, `${DEFAULT_LAMBDA_CODE_DIR}`)
      );

      expect(defaultFiles).toEqual(
        expect.arrayContaining([
          "index.js",
          "manifest.json",
          "chunks",
          "pages",
          "prerender-manifest.json",
          "routes-manifest.json",
          "testFile.js"
        ])
      );
    });
  });
});
