import execa from "execa";
import fse from "fs-extra";
import getAllFiles from "./lib/getAllFilesInDirectory";
import path from "path";
import { BuildManifest, RoutesManifest } from "./types";
import pathToPosix from "./lib/pathToPosix";
import createServerlessConfig from "./lib/createServerlessConfig";
import readDirectoryFiles from "./lib/readDirectoryFiles";
import filterOutDirectories from "./lib/filterOutDirectories";
import { Item } from "klaw";
import { prepareBuildManifests } from "@sls-next/core";
import { NextConfig } from "@sls-next/core/dist/build";

export const DEFAULT_LAMBDA_CODE_DIR = "default-lambda";
export const ASSETS_DIR = "assets";

type BuildOptions = {
  bucketName: string;
  region: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cmd?: string;
  logLambdaExecutionTimes?: boolean;
  domainRedirects?: { [key: string]: string };
  minifyHandlers?: boolean;
  enableHTTPCompression?: boolean;
  handler?: string;
  authentication?: { username: string; password: string } | undefined;
  baseDir?: string;
};

const defaultBuildOptions = {
  args: [],
  cwd: process.cwd(),
  env: {},
  cmd: "./node_modules/.bin/next",
  logLambdaExecutionTimes: false,
  domainRedirects: {},
  minifyHandlers: false,
  enableHTTPCompression: true,
  authentication: undefined,
  baseDir: process.cwd()
};

class Builder {
  nextConfigDir: string;
  nextStaticDir: string;
  dotNextDir: string;
  serverlessDir: string;
  outputDir: string;
  buildOptions: BuildOptions;

  constructor(
    nextConfigDir: string,
    outputDir: string,
    buildOptions: BuildOptions,
    nextStaticDir?: string
  ) {
    this.nextConfigDir = path.resolve(nextConfigDir);
    this.nextStaticDir = path.resolve(nextStaticDir ?? nextConfigDir);
    this.dotNextDir = path.join(this.nextConfigDir, ".next");
    this.serverlessDir = path.join(this.dotNextDir, "serverless");
    this.outputDir = outputDir;
    this.buildOptions = buildOptions ?? defaultBuildOptions;
  }

  async readPublicFiles(): Promise<string[]> {
    const dirExists = await fse.pathExists(
      path.join(this.nextConfigDir, "public")
    );
    if (dirExists) {
      return getAllFiles(path.join(this.nextConfigDir, "public"))
        .map((e) => e.replace(this.nextConfigDir, ""))
        .map((e) => e.split(path.sep).slice(2).join("/"));
    } else {
      return [];
    }
  }

  async readPagesManifest(): Promise<{ [key: string]: string }> {
    const manifestPath = path.join(this.serverlessDir, "pages-manifest.json");
    const hasServerlessPageManifest = await fse.pathExists(manifestPath);

    if (!hasServerlessPageManifest) {
      return Promise.reject(
        "pages-manifest not found. Check if `next.config.js` target is set to 'serverless'"
      );
    }

    return await fse.readJSON(manifestPath);
  }

  /**
   * Check whether this .next/serverless/pages file is a JS file used for runtime rendering.
   * @param buildManifest
   * @param relativePageFile
   */
  isSSRJSFile(buildManifest: BuildManifest, relativePageFile: string): boolean {
    if (path.extname(relativePageFile) === ".js") {
      const page = relativePageFile.startsWith("/")
        ? `pages${relativePageFile}`
        : `pages/${relativePageFile}`;
      if (
        page === "pages/_error.js" ||
        Object.values(buildManifest.pages.ssr.nonDynamic).includes(page) ||
        Object.values(buildManifest.pages.ssr.dynamic).includes(page)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Process and copy RoutesManifest.
   * @param source
   * @param destination
   */
  async processAndCopyRoutesManifest(source: string, destination: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const routesManifest = require(source) as RoutesManifest;

    // Remove default trailing slash redirects as they are already handled without regex matching.
    routesManifest.redirects = routesManifest.redirects.filter(
      (redirect) => !redirect.internal
    );

    await fse.writeFile(destination, JSON.stringify(routesManifest));
  }

  /**
   * Process and copy handler code. This allows minifying it before copying to Lambda package.
   * @param handlerType
   * @param destination
   * @param shouldMinify
   */
  async processAndCopyHandler(
    handlerType: "default-handler",
    destination: string,
    shouldMinify: boolean
  ) {
    const source = path.dirname(
      require.resolve(
        `@sls-next/lambda-at-edge/dist/${handlerType}/${
          shouldMinify ? "minified" : "standard"
        }`
      )
    );

    await fse.copy(source, destination);
  }

  async buildDefaultLambda(buildManifest: BuildManifest): Promise<void[]> {
    const hasAPIRoutes = await fse.pathExists(
      path.join(this.serverlessDir, "pages/api")
    );

    return Promise.all([
      this.processAndCopyHandler(
        "default-handler",
        path.join(this.outputDir, DEFAULT_LAMBDA_CODE_DIR),
        !!this.buildOptions.minifyHandlers
      ),
      this.buildOptions?.handler
        ? fse.copy(
            path.join(this.nextConfigDir, this.buildOptions.handler),
            path.join(
              this.outputDir,
              DEFAULT_LAMBDA_CODE_DIR,
              this.buildOptions.handler
            )
          )
        : Promise.resolve(),
      fse.writeJson(
        path.join(this.outputDir, DEFAULT_LAMBDA_CODE_DIR, "manifest.json"),
        buildManifest
      ),
      fse.copy(
        path.join(this.serverlessDir, "pages"),
        path.join(this.outputDir, DEFAULT_LAMBDA_CODE_DIR, "pages"),
        {
          filter: (file: string) => {
            const isNotPrerenderedHTMLPage = path.extname(file) !== ".html";
            const isNotStaticPropsJSONFile = path.extname(file) !== ".json";
            const isApiPage = pathToPosix(file).includes("pages/api");

            // If there are API routes, include all JS files.
            // If there are no API routes, include only JS files that used for SSR (including fallback).
            // We do this because if there are API routes, preview mode is possible which may use these JS files.
            // This is what Vercel does: https://github.com/vercel/next.js/discussions/15631#discussioncomment-44289
            // TODO: possibly optimize bundle further for those apps using API routes.
            const isNotExcludedJSFile =
              hasAPIRoutes ||
              path.extname(file) !== ".js" ||
              this.isSSRJSFile(
                buildManifest,
                path.relative(path.join(this.serverlessDir, "pages"), file)
              );

            return (
              isApiPage ||
              (isNotPrerenderedHTMLPage &&
                isNotStaticPropsJSONFile &&
                isNotExcludedJSFile)
            );
          }
        }
      ),
      this.copyChunks(DEFAULT_LAMBDA_CODE_DIR),
      fse.copy(
        path.join(this.dotNextDir, "prerender-manifest.json"),
        path.join(
          this.outputDir,
          DEFAULT_LAMBDA_CODE_DIR,
          "prerender-manifest.json"
        )
      ),
      this.processAndCopyRoutesManifest(
        path.join(this.dotNextDir, "routes-manifest.json"),
        path.join(
          this.outputDir,
          DEFAULT_LAMBDA_CODE_DIR,
          "routes-manifest.json"
        )
      )
    ]);
  }

  async copyChunks(buildDir: string): Promise<void> {
    return fse.existsSync(path.join(this.serverlessDir, "chunks"))
      ? fse.copy(
          path.join(this.serverlessDir, "chunks"),
          path.join(this.outputDir, buildDir, "chunks")
        )
      : Promise.resolve();
  }

  async readNextConfig(): Promise<NextConfig | undefined> {
    const nextConfigPath = path.join(this.nextConfigDir, "next.config.js");

    if (await fse.pathExists(nextConfigPath)) {
      const nextConfig = await require(nextConfigPath);

      let normalisedNextConfig;
      if (typeof nextConfig === "object") {
        normalisedNextConfig = nextConfig;
      } else if (typeof nextConfig === "function") {
        // Execute using phase based on: https://github.com/vercel/next.js/blob/8a489e24bcb6141ad706e1527b77f3ff38940b6d/packages/next/next-server/lib/constants.ts#L1-L4
        normalisedNextConfig = nextConfig("phase-production-server", {});
      }
      return normalisedNextConfig;
    }
  }

  /**
   * Build static assets such as client-side JS, public files, static pages, etc.
   * Note that the upload to S3 is done in a separate deploy step.
   */
  async buildStaticAssets(
    buildManifest: BuildManifest,
    routesManifest: RoutesManifest
  ) {
    const buildId = buildManifest.buildId;
    const basePath = routesManifest.basePath;
    const nextConfigDir = this.nextConfigDir;
    const nextStaticDir = this.nextStaticDir;

    const dotNextDirectory = path.join(this.nextConfigDir, ".next");

    const assetOutputDirectory = path.join(this.outputDir, ASSETS_DIR);

    const normalizedBasePath = basePath ? basePath.slice(1) : "";
    const withBasePath = (key: string): string =>
      path.join(normalizedBasePath, key);

    const copyIfExists = async (
      source: string,
      destination: string
    ): Promise<void> => {
      if (await fse.pathExists(source)) {
        await fse.copy(source, destination);
      }
    };

    // Copy BUILD_ID file
    const copyBuildId = copyIfExists(
      path.join(dotNextDirectory, "BUILD_ID"),
      path.join(assetOutputDirectory, withBasePath("BUILD_ID"))
    );

    const buildStaticFiles = await readDirectoryFiles(
      path.join(dotNextDirectory, "static")
    );

    const staticFileAssets = buildStaticFiles
      .filter(filterOutDirectories)
      .map(async (fileItem: Item) => {
        const source = fileItem.path;
        const destination = path.join(
          assetOutputDirectory,
          withBasePath(
            path
              .relative(path.resolve(nextConfigDir), source)
              .replace(/^.next/, "_next")
          )
        );

        return copyIfExists(source, destination);
      });

    const htmlPaths = [
      ...Object.keys(buildManifest.pages.html.dynamic),
      ...Object.keys(buildManifest.pages.html.nonDynamic)
    ];

    const ssgPaths = Object.keys(buildManifest.pages.ssg.nonDynamic);

    const fallbackFiles = Object.values(buildManifest.pages.ssg.dynamic)
      .map(({ fallback }) => fallback)
      .filter((fallback) => fallback);

    const htmlFiles = [...htmlPaths, ...ssgPaths].map((path) => {
      return path.endsWith("/") ? `${path}index.html` : `${path}.html`;
    });

    const jsonFiles = ssgPaths.map((path) => {
      return path.endsWith("/") ? `${path}index.json` : `${path}.json`;
    });

    const htmlAssets = [...htmlFiles, ...fallbackFiles].map((file) => {
      const source = path.join(dotNextDirectory, `serverless/pages${file}`);
      const destination = path.join(
        assetOutputDirectory,
        withBasePath(`static-pages/${buildId}${file}`)
      );

      return copyIfExists(source, destination);
    });

    const jsonAssets = jsonFiles.map((file) => {
      const source = path.join(dotNextDirectory, `serverless/pages${file}`);
      const destination = path.join(
        assetOutputDirectory,
        withBasePath(`_next/data/${buildId}${file}`)
      );

      return copyIfExists(source, destination);
    });

    // Check if public/static exists and fail build since this conflicts with static/* behavior.
    if (await fse.pathExists(path.join(nextStaticDir, "public", "static"))) {
      throw new Error(
        "You cannot have assets in the directory [public/static] as they conflict with the static/* CloudFront cache behavior. Please move these assets into another directory."
      );
    }

    const buildPublicOrStaticDirectory = async (
      directory: "public" | "static"
    ) => {
      const directoryPath = path.join(nextStaticDir, directory);
      if (!(await fse.pathExists(directoryPath))) {
        return Promise.resolve([]);
      }

      const files = await readDirectoryFiles(directoryPath);

      return files.filter(filterOutDirectories).map((fileItem: Item) => {
        const source = fileItem.path;
        const destination = path.join(
          assetOutputDirectory,
          withBasePath(
            path.relative(path.resolve(nextStaticDir), fileItem.path)
          )
        );

        return fse.copy(source, destination);
      });
    };

    const publicDirAssets = await buildPublicOrStaticDirectory("public");
    const staticDirAssets = await buildPublicOrStaticDirectory("static");

    return Promise.all([
      copyBuildId, // BUILD_ID
      ...staticFileAssets, // .next/static
      ...htmlAssets, // prerendered html pages
      ...jsonAssets, // SSG json files
      ...publicDirAssets, // public dir
      ...staticDirAssets // static dir
    ]);
  }

  async cleanupDotNext(): Promise<void> {
    const exists = await fse.pathExists(this.dotNextDir);

    if (exists) {
      const fileItems = await fse.readdir(this.dotNextDir);

      await Promise.all(
        fileItems
          .filter(
            (fileItem) => fileItem !== "cache" // avoid deleting the cache folder as that leads to slow next builds!
          )
          .map((fileItem) => fse.remove(path.join(this.dotNextDir, fileItem)))
      );
    }
  }

  async build(debugMode?: boolean): Promise<void> {
    const { cmd, args, cwd, env } = Object.assign(
      defaultBuildOptions,
      this.buildOptions
    );

    await this.cleanupDotNext();

    await fse.emptyDir(path.join(this.outputDir, DEFAULT_LAMBDA_CODE_DIR));
    await fse.emptyDir(path.join(this.outputDir, ASSETS_DIR));

    const { restoreUserConfig } = await createServerlessConfig(
      cwd,
      path.join(this.nextConfigDir)
    );

    try {
      const subprocess = execa(cmd, args, {
        cwd,
        env
      });

      if (debugMode) {
        // @ts-ignore
        subprocess.stdout.pipe(process.stdout);
      }

      await subprocess;
    } finally {
      await restoreUserConfig();
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const routesManifest = require(path.join(
      this.dotNextDir,
      "routes-manifest.json"
    ));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prerenderManifest = require(path.join(
      this.dotNextDir,
      "prerender-manifest.json"
    ));

    const options = {
      buildId: await fse.readFile(
        path.join(this.dotNextDir, "BUILD_ID"),
        "utf-8"
      ),
      ...this.buildOptions,
      domainRedirects: this.buildOptions.domainRedirects ?? {}
    };

    const { apiManifest, pageManifest } = await prepareBuildManifests(
      options,
      await this.readNextConfig(),
      routesManifest,
      await this.readPagesManifest(),
      prerenderManifest,
      await this.readPublicFiles()
    );

    const {
      bucketName,
      enableHTTPCompression,
      logLambdaExecutionTimes,
      region
    } = this.buildOptions;

    const buildManifest: BuildManifest = {
      ...apiManifest,
      ...pageManifest,
      enableHTTPCompression,
      logLambdaExecutionTimes,
      bucketName,
      region
    };

    await this.buildDefaultLambda(buildManifest);

    // Copy static assets to .serverless_nextjs directory
    await this.buildStaticAssets(buildManifest, routesManifest);
  }
}

export default Builder;
