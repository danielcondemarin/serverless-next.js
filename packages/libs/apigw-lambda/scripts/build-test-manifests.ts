/*
 * Updates test manifests
 * Call from lambda-at-edge/ using:
 *
 * scripts/build-test-manifests.ts N
 *
 * where N is the index of the test fixture from below.
 */
import fse from "fs-extra";
import { join } from "path";

import Builder from "../src/build";

const fixtureDir = "./tests/shared-fixtures/source";
const outDir = join(fixtureDir, "tmp");
const nextDir = join(fixtureDir, ".next");

const nextBinary = join(require.resolve("next"), "../../../../.bin/next");

const headers = `
headers: async () => [
  {
    source: "/customers/another",
    headers: [{key: "x-custom-header", value: "custom"}]
  },
  {
    source: "/api/getCustomers",
    headers: [{key: "x-custom-header", value: "custom"}]
  }
]
`;

const redirects = `
redirects: async () => [
  {
    source: "/old-blog/:slug",
    destination: "/news/:slug",
    permanent: true
  },
  {
    source: "/terms-new",
    destination: "/terms",
    permanent: true
  },
  {
    source: "/old-users/:id(\\\\d{1,})",
    destination: "/users/:id",
    permanent: false
  },
  {
    source: "/terms-redirect-dest-query",
    destination: "/terms?foo=bar",
    permanent: true,
  },
  {
    source: "/external",
    destination: "https://example.com",
    permanent: true
  },
  {
    source: "/api/deprecated/getCustomers",
    destination: "/api/getCustomers",
    permanent: true
  }
]
`;

const rewrites = `
rewrites: async () => [
  {
    source: "/terms-rewrite",
    destination: "/terms"
  },
  {
    source: "/index-rewrite",
    destination: "/"
  },
  {
    source: "/path-rewrite/:slug",
    destination: "/terms"
  },
  {
    source: "/terms",
    destination: "/"
  },
  {
    source: "/promise-page",
    destination: "/async-page"
  },
  {
    source: "/terms-rewrite-dest-query",
    destination: "/terms?foo=bar"
  },
  {
    source: "/external-rewrite",
    destination: "https://external.com"
  },
  {
    source: "/api/rewrite-getCustomers",
    destination: "/api/getCustomers"
  },
  {
    source: "/api/getCustomers",
    destination: "/api/another"
  },
  {
    source: "/api/notfound",
    destination: "/api/missing"
  },
  {
    source: "/api/user/:id",
    destination: "/api/getUser"
  },
  {
    source: "/api/external-rewrite",
    destination: "https://external.com"
  },
]
`;

const fixtures = [
  {
    config: `
module.exports = {
  generateBuildId: async () => "build-id",
  trailingSlash: false,
  ${headers},
  ${redirects},
  ${rewrites}
}
`,
    default: "./tests/default-handler/default-build-manifest.json",
    routes: "./tests/default-handler/default-routes-manifest.json",
    prerender: "./tests/default-handler/prerender-manifest.json"
  },
  {
    config: `
module.exports = {
  generateBuildId: async () => "build-id",
  trailingSlash: false,
  basePath: "/basepath",
  ${headers},
  ${redirects},
  ${rewrites}
}
`,
    default: null,
    routes: "./tests/default-handler/default-basepath-routes-manifest.json"
  }
];

const build = async (auth: boolean) => {
  const builder = new Builder(fixtureDir, outDir, {
    bucketName: "test-bucket",
    region: "us-east-1",
    cwd: fixtureDir,
    cmd: nextBinary,
    args: ["build"],
    domainRedirects: {
      "example.com": "https://www.example.com"
    },
    authentication: auth
      ? {
          username: "test",
          password: "123"
        }
      : undefined
  });
  await builder.build();
};

const cleanUp = () => {
  fse.removeSync(nextDir);
  fse.removeSync(outDir);
  fse.removeSync(join(fixtureDir, "next.config.js"));
};

(async () => {
  const fixture = fixtures[parseInt(process.argv[2]) || 0];
  cleanUp();

  if (fixture.config) {
    fse.writeFileSync(join(fixtureDir, "next.config.js"), fixture.config ?? "");
  }

  try {
    await build(!!(fixture as any).auth);
  } catch (e) {
    console.error(e);
  }

  if (fixture.default) {
    const defaultManifest = fse.readJSONSync(
      join(outDir, "default-lambda/manifest.json")
    );
    fse.writeJSON(fixture.default ?? "", defaultManifest, { spaces: 2 });
  }
  if (fixture.prerender) {
    const prerenderManifest = fse.readJSONSync(
      join(outDir, "default-lambda/prerender-manifest.json")
    );
    prerenderManifest.preview = {
      previewModeId: "test-preview-mode-id",
      previewModeSigningKey: "test-preview-mode-signing-key",
      previewModeEncryptionKey: "test-preview-mode-enc-key"
    };
    fse.writeJSON(fixture.prerender ?? "", prerenderManifest, { spaces: 2 });
  }
  if (fixture.routes) {
    const routesManifest = fse.readJSONSync(
      join(outDir, "default-lambda/routes-manifest.json")
    );
    fse.writeJSON(fixture.routes ?? "", routesManifest, { spaces: 2 });
  }
})();
