import fse from "fs-extra";
import path from "path";
import { mockDomain } from "@sls-next/domain";
import { mockS3 } from "@serverless/aws-s3";
import { mockUpload } from "aws-sdk";
import { mockLambda, mockLambdaPublish } from "@sls-next/aws-lambda";
import mockCreateInvalidation from "@sls-next/cloudfront";
import { mockCloudFront } from "@sls-next/aws-cloudfront";
import { mockSQS } from "@sls-next/aws-sqs";

import NextjsComponent, { DeploymentResult } from "../src/component";
import obtainDomains from "../src/lib/obtainDomains";
import { DEFAULT_LAMBDA_CODE_DIR, API_LAMBDA_CODE_DIR } from "../src/constants";
import { cleanupFixtureDirectory } from "../src/lib/test-utils";

// unfortunately can't use __mocks__ because aws-sdk is being mocked in other
// packages in the monorepo
// https://github.com/facebook/jest/issues/2070
jest.mock("aws-sdk", () => require("./aws-sdk.mock"));

const createNextComponent = () => {
  const component = new NextjsComponent();
  component.context.credentials = {
    aws: {
      accessKeyId: "123",
      secretAccessKey: "456"
    }
  };
  return component;
};

const mockServerlessComponentDependencies = ({ expectedDomain }) => {
  mockS3.mockResolvedValue({
    name: "bucket-xyz"
  });

  mockLambda.mockResolvedValue({
    arn: "arn:aws:lambda:us-east-1:123456789012:function:my-func"
  });

  mockLambdaPublish.mockResolvedValue({
    version: "v1"
  });

  mockCloudFront.mockResolvedValueOnce({
    url: "https://cloudfrontdistrib.amazonaws.com"
  });

  mockDomain.mockResolvedValueOnce({
    domains: [expectedDomain]
  });

  mockSQS.mockResolvedValue({
    arn: "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo"
  });
};

describe("Custom inputs", () => {
  let componentOutputs: DeploymentResult;
  let consoleWarnSpy;

  beforeEach(() => {
    const realFseRemove = fse.remove.bind({});
    jest.spyOn(fse, "remove").mockImplementation((filePath) => {
      // don't delete mocked .next/ files as they're needed for the tests and committed to source control
      if (!filePath.includes(".next" + path.sep)) {
        return realFseRemove(filePath);
      }
    });

    consoleWarnSpy = jest.spyOn(console, "warn").mockReturnValue();
  });

  afterEach(() => {
    fse.remove.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe.each`
    inputRegion    | expectedRegion
    ${undefined}   | ${"us-east-1"}
    ${"eu-west-2"} | ${"eu-west-2"}
  `(`When input region is $inputRegion`, ({ inputRegion, expectedRegion }) => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        bucketRegion: inputRegion
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`passes the ${expectedRegion} region to the s3 and cloudFront components`, () => {
      expect(mockS3).toBeCalledWith(
        expect.objectContaining({
          region: expectedRegion
        })
      );
      expect(mockCloudFront).toBeCalledWith(
        expect.objectContaining({
          origins: expect.arrayContaining([
            expect.objectContaining({
              url: `http://bucket-xyz.s3.${expectedRegion}.amazonaws.com`
            })
          ])
        })
      );
    });
  });

  describe.each`
    inputDomains                  | expectedDomain
    ${["dev", "example.com"]}     | ${"https://dev.example.com"}
    ${["www", "example.com"]}     | ${"https://www.example.com"}
    ${"example.com"}              | ${"https://www.example.com"}
    ${[undefined, "example.com"]} | ${"https://www.example.com"}
    ${"example.com"}              | ${"https://www.example.com"}
  `("Custom domain", ({ inputDomains, expectedDomain }) => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({
        expectedDomain
      });

      const component = createNextComponent();

      componentOutputs = await component.default({
        policy: "arn:aws:iam::aws:policy/CustomRole",
        domain: inputDomains,
        description: "Custom description",
        memory: 512
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it("uses @sls-next/domain to provision custom domain", () => {
      const { domain, subdomain } = obtainDomains(inputDomains);

      expect(mockDomain).toBeCalledWith({
        defaultCloudfrontInputs: {},
        domainType: "both",
        privateZone: false,
        domain,
        subdomains: {
          [subdomain as string]: {
            url: "https://cloudfrontdistrib.amazonaws.com"
          }
        }
      });
    });

    it("uses custom policy document provided", () => {
      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("Custom description"),
          role: expect.objectContaining({
            policy: {
              arn: "arn:aws:iam::aws:policy/CustomRole"
            }
          })
        })
      );
    });

    it("outputs custom domain url", () => {
      expect(componentOutputs.appUrl).toEqual(expectedDomain);
    });
  });

  describe("Custom role arn", () => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        roleArn: "arn:aws:iam::aws:role/CustomRole"
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it("uses custom role arn provided", () => {
      expect(mockLambda).toBeCalledTimes(3);

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          role: expect.objectContaining({
            arn: "arn:aws:iam::aws:role/CustomRole"
          })
        })
      );
    });
  });

  describe.each`
    nextConfigDir      | nextStaticDir      | fixturePath
    ${"nextConfigDir"} | ${"nextStaticDir"} | ${path.join(__dirname, "./fixtures/split-app")}
  `(
    "nextConfigDir=$nextConfigDir, nextStaticDir=$nextStaticDir",
    ({ fixturePath, ...inputs }) => {
      let tmpCwd: string;

      beforeEach(async () => {
        tmpCwd = process.cwd();
        process.chdir(fixturePath);

        mockServerlessComponentDependencies({ expectedDomain: undefined });

        const component = createNextComponent();

        componentOutputs = await component.default({
          nextConfigDir: inputs.nextConfigDir,
          nextStaticDir: inputs.nextStaticDir
        });
      });

      afterEach(() => {
        process.chdir(tmpCwd);
        return cleanupFixtureDirectory(fixturePath);
      });

      it("uploads static assets to S3 correctly", () => {
        expect(mockUpload).toBeCalledTimes(12);

        [
          "static-pages/test-build-id/index.html",
          "static-pages/test-build-id/terms.html",
          "static-pages/test-build-id/404.html",
          "static-pages/test-build-id/about.html"
        ].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl:
                "public, max-age=0, s-maxage=2678400, must-revalidate"
            })
          );
        });

        ["static-pages/test-build-id/blog/[post].html"].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl: "public, max-age=0, s-maxage=0, must-revalidate"
            })
          );
        });

        ["_next/static/test-build-id/placeholder.js"].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl: "public, max-age=31536000, immutable"
            })
          );
        });

        ["_next/data/test-build-id/index.json"].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl:
                "public, max-age=0, s-maxage=2678400, must-revalidate"
            })
          );
        });

        ["public/sub/image.png", "public/favicon.ico"].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl: "public, max-age=31536000, must-revalidate"
            })
          );
        });

        // Only certain public/static file extensions are cached by default
        ["public/sw.js", "static/donotdelete.txt"].forEach((file) => {
          expect(mockUpload).toBeCalledWith(
            expect.objectContaining({
              Key: file,
              CacheControl: undefined
            })
          );
        });
      });
    }
  );

  describe.each`
    publicDirectoryCache                                           | expected
    ${undefined}                                                   | ${"public, max-age=31536000, must-revalidate"}
    ${false}                                                       | ${undefined}
    ${{ test: "/.(ico|png)$/i", value: "public, max-age=306000" }} | ${"public, max-age=306000"}
  `(
    "input=inputPublicDirectoryCache, expected=$expectedPublicDirectoryCache",
    ({ publicDirectoryCache, expected }) => {
      let tmpCwd: string;
      const fixturePath = path.join(__dirname, "./fixtures/simple-app");

      beforeEach(async () => {
        tmpCwd = process.cwd();
        process.chdir(fixturePath);

        mockServerlessComponentDependencies({ expectedDomain: undefined });

        const component = createNextComponent();

        componentOutputs = await component.default({
          publicDirectoryCache
        });
      });

      afterEach(() => {
        process.chdir(tmpCwd);
        return cleanupFixtureDirectory(fixturePath);
      });

      it(`sets the ${expected} Cache - Control header on ${publicDirectoryCache} `, () => {
        expect(mockUpload).toBeCalledWith(
          expect.objectContaining({
            Key: expect.stringMatching("public/favicon.ico"),
            CacheControl: expected
          })
        );
      });
    }
  );

  describe.each([
    [undefined, { defaultMemory: 512, apiMemory: 512 }],
    [{}, { defaultMemory: 512, apiMemory: 512 }],
    [1024, { defaultMemory: 1024, apiMemory: 1024 }],
    [{ defaultLambda: 1024 }, { defaultMemory: 1024, apiMemory: 512 }],
    [{ apiLambda: 2048 }, { defaultMemory: 512, apiMemory: 2048 }],
    [
      { defaultLambda: 128, apiLambda: 2048 },
      { defaultMemory: 128, apiMemory: 2048 }
    ]
  ])("Lambda memory input", (inputMemory, expectedMemory) => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        memory: inputMemory
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`sets default lambda memory to ${expectedMemory.defaultMemory} and api lambda memory to ${expectedMemory.apiMemory} `, () => {
      const { defaultMemory, apiMemory } = expectedMemory;

      // default Lambda
      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR),
          memory: defaultMemory
        })
      );

      // api Lambda
      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, API_LAMBDA_CODE_DIR),
          memory: apiMemory
        })
      );
    });
  });

  describe.each`
    inputTimeout                            | expectedTimeout
    ${undefined}                            | ${{ defaultTimeout: 10, apiTimeout: 10 }}
    ${{}}                                   | ${{ defaultTimeout: 10, apiTimeout: 10 }}
    ${40}                                   | ${{ defaultTimeout: 40, apiTimeout: 40 }}
    ${{ defaultLambda: 20 }}                | ${{ defaultTimeout: 20, apiTimeout: 10 }}
    ${{ apiLambda: 20 }}                    | ${{ defaultTimeout: 10, apiTimeout: 20 }}
    ${{ defaultLambda: 15, apiLambda: 20 }} | ${{ defaultTimeout: 15, apiTimeout: 20 }}
  `("Input timeout options", ({ inputTimeout, expectedTimeout }) => {
    let tmpCwd: string;
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        timeout: inputTimeout
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`sets default lambda timeout to ${expectedTimeout.defaultTimeout} and api lambda timeout to ${expectedTimeout.apiTimeout} `, () => {
      const { defaultTimeout, apiTimeout } = expectedTimeout;

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR),
          timeout: defaultTimeout
        })
      );

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, API_LAMBDA_CODE_DIR),
          timeout: apiTimeout
        })
      );
    });
  });

  describe.each`
    inputRuntime                                                | expectedRuntime
    ${undefined}                                                | ${{ defaultRuntime: "nodejs12.x", apiRuntime: "nodejs12.x" }}
    ${{}}                                                       | ${{ defaultRuntime: "nodejs12.x", apiRuntime: "nodejs12.x" }}
    ${"nodejs10.x"}                                             | ${{ defaultRuntime: "nodejs10.x", apiRuntime: "nodejs10.x" }}
    ${{ defaultLambda: "nodejs10.x" }}                          | ${{ defaultRuntime: "nodejs10.x", apiRuntime: "nodejs12.x" }}
    ${{ apiLambda: "nodejs10.x" }}                              | ${{ defaultRuntime: "nodejs12.x", apiRuntime: "nodejs10.x" }}
    ${{ defaultLambda: "nodejs10.x", apiLambda: "nodejs10.x" }} | ${{ defaultRuntime: "nodejs10.x", apiRuntime: "nodejs10.x" }}
  `("Input runtime options", ({ inputRuntime, expectedRuntime }) => {
    let tmpCwd: string;
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        runtime: inputRuntime
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`sets default lambda runtime to ${expectedRuntime.defaultRuntime} and api lambda runtime to ${expectedRuntime.apiRuntime} `, () => {
      const { defaultRuntime, apiRuntime } = expectedRuntime;

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR),
          runtime: defaultRuntime
        })
      );

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, API_LAMBDA_CODE_DIR),
          runtime: apiRuntime
        })
      );
    });
  });

  describe.each`
    inputName                                                     | expectedName
    ${undefined}                                                  | ${{ defaultName: undefined, apiName: undefined }}
    ${{}}                                                         | ${{ defaultName: undefined, apiName: undefined }}
    ${"fooFunction"}                                              | ${{ defaultName: "fooFunction", apiName: "fooFunction" }}
    ${{ defaultLambda: "fooFunction" }}                           | ${{ defaultName: "fooFunction", apiName: undefined }}
    ${{ apiLambda: "fooFunction" }}                               | ${{ defaultName: undefined, apiName: "fooFunction" }}
    ${{ defaultLambda: "fooFunction", apiLambda: "barFunction" }} | ${{ defaultName: "fooFunction", apiName: "barFunction" }}
  `("Lambda name input", ({ inputName, expectedName }) => {
    let tmpCwd: string;
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        name: inputName
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`sets default lambda name to ${expectedName.defaultName} and api lambda name to ${expectedName.apiName} `, () => {
      const { defaultName, apiName } = expectedName;

      const expectedDefaultObject = {
        code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR)
      };
      if (defaultName) expectedDefaultObject.name = defaultName;

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining(expectedDefaultObject)
      );

      const expectedApiObject = {
        code: path.join(fixturePath, API_LAMBDA_CODE_DIR)
      };
      if (apiName) expectedApiObject.name = apiName;

      expect(mockLambda).toBeCalledWith(
        expect.objectContaining(expectedApiObject)
      );
    });
  });

  describe.each([
    // no input
    [undefined, {}],
    // empty input
    [{}, {}],
    // ignores origin-request and origin-response triggers as they're reserved by serverless-next.js
    [
      {
        defaults: {
          minTTL: 0,
          defaultTTL: 0,
          maxTTL: 31536000,
          "lambda@edge": {
            "origin-request": "ignored",
            "origin-response": "also ignored"
          }
        }
      },
      { defaults: { minTTL: 0, defaultTTL: 0, maxTTL: 31536000 } }
    ],
    // allow lamdba@edge triggers other than origin-request and origin-response
    [
      {
        defaults: {
          minTTL: 0,
          defaultTTL: 0,
          maxTTL: 31536000,
          "lambda@edge": {
            "viewer-request": "used value"
          }
        }
      },
      {
        defaults: {
          minTTL: 0,
          defaultTTL: 0,
          maxTTL: 31536000,
          "lambda@edge": { "viewer-request": "used value" }
        }
      }
    ],
    [
      {
        defaults: {
          forward: { cookies: "all", headers: "X", queryString: true }
        }
      },
      {
        defaults: {
          forward: { cookies: "all", headers: "X", queryString: true }
        }
      }
    ],
    // ignore custom lambda@edge origin-request trigger set on the api cache behaviour
    [
      {
        "api/*": {
          minTTL: 500,
          defaultTTL: 500,
          maxTTL: 500,
          "lambda@edge": { "origin-request": "ignored value" }
        }
      },
      { "api/*": { minTTL: 500, defaultTTL: 500, maxTTL: 500 } }
    ],
    // allow other lambda@edge triggers on the api cache behaviour
    [
      {
        "api/*": {
          minTTL: 500,
          defaultTTL: 500,
          maxTTL: 500,
          "lambda@edge": { "origin-response": "used value" }
        }
      },
      {
        "api/*": {
          minTTL: 500,
          defaultTTL: 500,
          maxTTL: 500,
          "lambda@edge": { "origin-response": "used value" }
        }
      }
    ],
    // custom origins and expanding relative URLs to full S3 origin
    [
      {
        origins: [
          "http://some-origin",
          "/relative",
          { url: "http://diff-origin" },
          { url: "/diff-relative" }
        ]
      },
      {
        origins: [
          "http://some-origin",
          "http://bucket-xyz.s3.us-east-1.amazonaws.com/relative",
          { url: "http://diff-origin" },
          { url: "http://bucket-xyz.s3.us-east-1.amazonaws.com/diff-relative" }
        ]
      }
    ],
    // custom priceClass
    [
      {
        priceClass: "PriceClass_100"
      },
      {
        priceClass: "PriceClass_100"
      }
    ],
    // custom page cache behaviours
    [
      {
        "/terms": {
          minTTL: 5500,
          defaultTTL: 5500,
          maxTTL: 5500,
          "misc-param": "misc-value",
          "lambda@edge": {
            "origin-request": "ignored value"
          }
        }
      },
      {
        "/terms": {
          minTTL: 5500,
          defaultTTL: 5500,
          maxTTL: 5500,
          "misc-param": "misc-value"
        }
      }
    ],
    [
      {
        "/customers/stan-sack": {
          minTTL: 5500,
          defaultTTL: 5500,
          maxTTL: 5500
        }
      },
      {
        "/customers/stan-sack": {
          minTTL: 5500,
          defaultTTL: 5500,
          maxTTL: 5500
        }
      }
    ]
  ])("Custom cloudfront inputs", (inputCloudfrontConfig, expectedInConfig) => {
    let tmpCwd: string;
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    const {
      origins = [],
      defaults = {},
      priceClass = undefined,
      ...other
    } = expectedInConfig;

    const expectedDefaultCacheBehaviour = {
      ...defaults,
      "lambda@edge": {
        "origin-request":
          "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1",
        ...defaults["lambda@edge"]
      }
    };

    const expectedApiCacheBehaviour = {
      ...expectedInConfig["api/*"],
      allowedHttpMethods: [
        "HEAD",
        "DELETE",
        "POST",
        "GET",
        "OPTIONS",
        "PUT",
        "PATCH"
      ],
      "lambda@edge": {
        ...(expectedInConfig["api/*"] &&
          expectedInConfig["api/*"]["lambda@edge"]),
        "origin-request":
          "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
      }
    };

    const customPageCacheBehaviours = {};
    Object.entries(other).forEach(([path, cacheBehaviour]) => {
      customPageCacheBehaviours[path] = {
        ...cacheBehaviour,
        "lambda@edge": {
          "origin-request":
            "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1",
          ...(cacheBehaviour && cacheBehaviour["lambda@edge"])
        }
      };
    });

    const cloudfrontConfig = {
      defaults: {
        minTTL: 0,
        defaultTTL: 0,
        maxTTL: 31536000,
        allowedHttpMethods: [
          "HEAD",
          "DELETE",
          "POST",
          "GET",
          "OPTIONS",
          "PUT",
          "PATCH"
        ],
        forward: {
          cookies: "all",
          queryString: true
        },
        compress: true,
        ...expectedDefaultCacheBehaviour
      },
      origins: [
        {
          pathPatterns: {
            ...customPageCacheBehaviours,
            "_next/static/*": {
              ...customPageCacheBehaviours["_next/static/*"],
              minTTL: 0,
              defaultTTL: 86400,
              maxTTL: 31536000,
              forward: {
                headers: "none",
                cookies: "none",
                queryString: false
              }
            },
            "_next/data/*": {
              minTTL: 0,
              defaultTTL: 0,
              maxTTL: 31536000,
              allowedHttpMethods: ["HEAD", "GET"],
              "lambda@edge": {
                "origin-request":
                  "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
              }
            },
            "api/*": {
              minTTL: 0,
              defaultTTL: 0,
              maxTTL: 31536000,
              ...expectedApiCacheBehaviour
            },
            "_next/image*": {
              minTTL: 0,
              defaultTTL: 60,
              maxTTL: 31536000,
              "lambda@edge": {
                "origin-request":
                  "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
              },
              forward: {
                headers: ["Accept"]
              },
              allowedHttpMethods: expect.any(Array)
            },
            "static/*": {
              ...customPageCacheBehaviours["static/*"],
              minTTL: 0,
              defaultTTL: 86400,
              maxTTL: 31536000,
              forward: {
                headers: "none",
                cookies: "none",
                queryString: false
              }
            }
          },
          private: true,
          url: "http://bucket-xyz.s3.us-east-1.amazonaws.com"
        },
        ...origins
      ],
      ...(priceClass && { priceClass })
    };

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        cloudfront: inputCloudfrontConfig
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it("Sets cloudfront options if present", () => {
      expect(mockCloudFront).toBeCalledWith(
        expect.objectContaining(cloudfrontConfig)
      );
    });
  });

  describe.each`
    cloudFrontInput                                | expectedErrorMessage
    ${{ "some-invalid-page-route": { ttl: 100 } }} | ${'Could not find next.js pages for "some-invalid-page-route"'}
  `(
    "Invalid cloudfront inputs",
    ({ cloudFrontInput, expectedErrorMessage }) => {
      const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
      let tmpCwd: string;

      beforeEach(() => {
        tmpCwd = process.cwd();
        process.chdir(fixturePath);

        mockServerlessComponentDependencies({ expectedDomain: undefined });
      });

      afterEach(() => {
        process.chdir(tmpCwd);
        return cleanupFixtureDirectory(fixturePath);
      });

      it("throws the correct error", async () => {
        expect.assertions(1);

        try {
          await createNextComponent().default({
            cloudfront: cloudFrontInput
          });
        } catch (err) {
          expect(err.message).toContain(expectedErrorMessage);
        }
      });
    }
  );

  describe.each`
    cloudFrontInput                                                  | pathName
    ${{ api: { minTTL: 100, maxTTL: 100, defaultTTL: 100 } }}        | ${"api"}
    ${{ "api/test": { minTTL: 100, maxTTL: 100, defaultTTL: 100 } }} | ${"api/test"}
    ${{ "api/*": { minTTL: 100, maxTTL: 100, defaultTTL: 100 } }}    | ${"api/*"}
  `("API cloudfront inputs", ({ cloudFrontInput, pathName }) => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });

      const component = createNextComponent();

      componentOutputs = await component.default({
        cloudfront: cloudFrontInput
      });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`allows setting custom cache behavior: ${JSON.stringify(
      cloudFrontInput
    )}`, () => {
      cloudFrontInput[pathName]["lambda@edge"] = {
        "origin-request":
          "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
      };

      // If path is api/*, then it has allowed HTTP methods by default
      if (pathName === "api/*") {
        cloudFrontInput[pathName]["allowedHttpMethods"] = [
          "HEAD",
          "DELETE",
          "POST",
          "GET",
          "OPTIONS",
          "PUT",
          "PATCH"
        ];
      }

      const expectedInput = {
        origins: [
          {
            pathPatterns: {
              "_next/data/*": {
                allowedHttpMethods: ["HEAD", "GET"],
                defaultTTL: 0,
                "lambda@edge": {
                  "origin-request":
                    "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
                },
                maxTTL: 31536000,
                minTTL: 0
              },
              "_next/static/*": {
                defaultTTL: 86400,
                forward: {
                  cookies: "none",
                  headers: "none",
                  queryString: false
                },
                maxTTL: 31536000,
                minTTL: 0
              },
              "api/*": {
                allowedHttpMethods: [
                  "HEAD",
                  "DELETE",
                  "POST",
                  "GET",
                  "OPTIONS",
                  "PUT",
                  "PATCH"
                ],
                defaultTTL: 0,
                "lambda@edge": {
                  "origin-request":
                    "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
                },
                maxTTL: 31536000,
                minTTL: 0
              },
              "_next/image*": {
                minTTL: 0,
                defaultTTL: 60,
                maxTTL: 31536000,
                "lambda@edge": {
                  "origin-request":
                    "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1"
                },
                forward: {
                  headers: ["Accept"]
                },
                allowedHttpMethods: expect.any(Array)
              },
              "static/*": {
                defaultTTL: 86400,
                forward: {
                  cookies: "none",
                  headers: "none",
                  queryString: false
                },
                maxTTL: 31536000,
                minTTL: 0
              },
              ...cloudFrontInput
            },
            private: true,
            url: "http://bucket-xyz.s3.us-east-1.amazonaws.com"
          }
        ]
      };

      expect(mockCloudFront).toBeCalledWith(
        expect.objectContaining(expectedInput)
      );
    });
  });

  describe("Build using serverless trace target", () => {
    const fixturePath = path.join(__dirname, "./fixtures/simple-app");
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it("builds correctly", async () => {
      await createNextComponent().default({
        useServerlessTraceTarget: true
      });
    });
  });

  describe.each([false, "false"])(
    "Skip deployment after build",
    (deployInput) => {
      const fixturePath = path.join(__dirname, "./fixtures/simple-app");
      let tmpCwd: string;

      beforeEach(() => {
        tmpCwd = process.cwd();
        process.chdir(fixturePath);

        mockServerlessComponentDependencies({ expectedDomain: undefined });
      });

      afterEach(() => {
        process.chdir(tmpCwd);
        return cleanupFixtureDirectory(fixturePath);
      });

      it("builds but skips deployment", async () => {
        const result = await createNextComponent().default({
          deploy: deployInput
        });

        expect(result).toEqual({
          appUrl: "SKIPPED_DEPLOY",
          bucketName: "SKIPPED_DEPLOY",
          distributionId: "SKIPPED_DEPLOY"
        });
      });
    }
  );

  describe.each([
    [undefined, "index.handler"],
    ["customHandler.handler", "customHandler.handler"]
  ])("Lambda handler input", (inputHandler, expectedHandler) => {
    const fixturePath = path.join(__dirname, "./fixtures/generic-fixture");
    let tmpCwd: string;

    beforeEach(async () => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });
      const component = createNextComponent();
      componentOutputs = await component.default({ handler: inputHandler });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it(`sets handler to ${expectedHandler} and api lambda handler to ${expectedHandler}`, () => {
      // default Lambda
      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR),
          handler: expectedHandler
        })
      );

      // api Lambda
      expect(mockLambda).toBeCalledWith(
        expect.objectContaining({
          code: path.join(fixturePath, API_LAMBDA_CODE_DIR),
          handler: expectedHandler
        })
      );
    });
  });

  describe("Miscellaneous CloudFront inputs", () => {
    const fixturePath = path.join(__dirname, "./fixtures/simple-app");
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = process.cwd();
      process.chdir(fixturePath);

      mockServerlessComponentDependencies({ expectedDomain: undefined });
    });

    afterEach(() => {
      process.chdir(tmpCwd);
      return cleanupFixtureDirectory(fixturePath);
    });

    it("sets custom comment", async () => {
      await createNextComponent().default({
        cloudfront: {
          comment: "a comment"
        }
      });
    });

    it("sets web ACL id for AWS WAF", async () => {
      await createNextComponent().default({
        cloudfront: {
          webACLId:
            "arn:aws:wafv2:us-east-1:123456789012:global/webacl/ExampleWebACL/473e64fd-f30b-4765-81a0-62ad96dd167a"
        }
      });
    });

    it("sets restrictions", async () => {
      await createNextComponent().default({
        cloudfront: {
          restrictions: {
            geoRestriction: {
              restrictionType: "blacklist",
              items: ["AA"]
            }
          }
        }
      });
    });

    it("sets certificate with an ACM ARN", async () => {
      await createNextComponent().default({
        cloudfront: {
          certificate: {
            cloudFrontDefaultCertificate: false,
            acmCertificateArn:
              "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
          }
        }
      });
    });

    it("sets certificate with an IAM certificate", async () => {
      await createNextComponent().default({
        cloudfront: {
          certificate: {
            cloudFrontDefaultCertificate: false,
            iamCertificateId: "iam-cert-id"
          }
        }
      });
    });

    it("sets certificate to default", async () => {
      await createNextComponent().default({
        cloudfront: {
          certificate: {
            cloudFrontDefaultCertificate: true
          }
        }
      });
    });

    it("sets invalidation paths", async () => {
      const pathsConfig = ["/foo", "/bar"];
      await createNextComponent().default({
        cloudfront: {
          paths: pathsConfig
        }
      });
      expect(mockCreateInvalidation).toBeCalledWith(
        expect.objectContaining({ paths: pathsConfig })
      );
    });

    it("skips invalidation", async () => {
      await createNextComponent().default({
        cloudfront: {
          paths: []
        }
      });
      expect(mockCreateInvalidation).not.toBeCalled();
    });
  });
});
