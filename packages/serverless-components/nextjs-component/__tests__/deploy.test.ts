import path from "path";
import fse from "fs-extra";
import { mockS3 } from "@serverless/aws-s3";
import { mockCloudFront } from "@sls-next/aws-cloudfront";
import { mockLambda, mockLambdaPublish } from "@sls-next/aws-lambda";
import mockCreateInvalidation from "@sls-next/cloudfront";
import NextjsComponent from "../src/component";
import { mockSQS } from "@sls-next/aws-sqs";
import {
  DEFAULT_LAMBDA_CODE_DIR,
  API_LAMBDA_CODE_DIR,
  IMAGE_LAMBDA_CODE_DIR,
  REGENERATION_LAMBDA_CODE_DIR
} from "../src/constants";
import { cleanupFixtureDirectory } from "../src/lib/test-utils";
import { mockUpload } from "aws-sdk";

// unfortunately can't use __mocks__ because aws-sdk is being mocked in other
// packages in the monorepo
// https://github.com/facebook/jest/issues/2070
jest.mock("aws-sdk", () => require("./aws-sdk.mock"));

describe.each`
  appPath                      | expectsQueueDeployment | name
  ${"./fixtures/simple-app"}   | ${false}               | ${"without ISR"}
  ${"./fixtures/app-with-isr"} | ${true}                | ${"with ISR"}
`("deploy tests ($name)", ({ appPath, expectsQueueDeployment }) => {
  let tmpCwd;
  let componentOutputs;
  let consoleWarnSpy;

  const fixturePath = path.join(__dirname, appPath);

  beforeEach(async () => {
    const realFseRemove = fse.remove.bind({});
    jest.spyOn(fse, "remove").mockImplementation((filePath) => {
      // don't delete mocked .next/ files as they're needed for the tests and committed to source control
      if (!filePath.includes(".next" + path.sep)) {
        return realFseRemove(filePath);
      }
    });
    consoleWarnSpy = jest.spyOn(console, "warn").mockReturnValue();

    tmpCwd = process.cwd();
    process.chdir(fixturePath);

    mockS3.mockResolvedValue({
      name: "bucket-xyz"
    });
    if (expectsQueueDeployment) {
      mockLambda.mockResolvedValueOnce({
        arn: "arn:aws:lambda:us-east-1:123456789012:function:regeneration-cachebehavior-func"
      });
    }
    mockLambda.mockResolvedValueOnce({
      arn: "arn:aws:lambda:us-east-1:123456789012:function:api-cachebehavior-func"
    });
    mockLambda.mockResolvedValueOnce({
      arn: "arn:aws:lambda:us-east-1:123456789012:function:image-cachebehavior-func"
    });
    mockLambda.mockResolvedValueOnce({
      arn: "arn:aws:lambda:us-east-1:123456789012:function:default-cachebehavior-func"
    });
    mockLambdaPublish.mockResolvedValue({
      version: "v1"
    });
    mockCloudFront.mockResolvedValueOnce({
      id: "cloudfrontdistrib",
      url: "https://cloudfrontdistrib.amazonaws.com"
    });

    if (expectsQueueDeployment) {
      mockSQS.mockResolvedValue({
        arn: "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo"
      });
    }

    const component = new NextjsComponent();
    component.context.credentials = {
      aws: {
        accessKeyId: "123",
        secretAccessKey: "456"
      }
    };

    await component.build();

    componentOutputs = await component.deploy();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    fse.remove.mockRestore();
    process.chdir(tmpCwd);
  });

  afterAll(cleanupFixtureDirectory(fixturePath));

  it("outputs next application url from cloudfront", () => {
    expect(componentOutputs.appUrl).toEqual(
      "https://cloudfrontdistrib.amazonaws.com"
    );
  });

  it("outputs S3 bucket name", () => {
    expect(componentOutputs.bucketName).toEqual("bucket-xyz");
  });

  describe("cloudfront", () => {
    if (expectsQueueDeployment) {
      it("provisions regeneration lambda", () => {
        expect(mockLambda).toHaveBeenNthCalledWith(1, {
          description: expect.any(String),
          handler: "index.handler",
          code: path.join(fixturePath, REGENERATION_LAMBDA_CODE_DIR),
          memory: 512,
          timeout: 10,
          runtime: "nodejs12.x",
          name: "bucket-xyz",
          region: "us-east-1",
          role: {
            service: ["lambda.amazonaws.com"],
            policy: {
              Version: "2012-10-17",
              Statement: expect.arrayContaining([
                {
                  Effect: "Allow",
                  Resource: "*",
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                  ]
                },
                {
                  Effect: "Allow",
                  Resource: `arn:aws:s3:::bucket-xyz/*`,
                  Action: ["s3:GetObject", "s3:PutObject"]
                },
                {
                  Effect: "Allow",
                  Resource: "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo",
                  Action: ["sqs:SendMessage"]
                },
                {
                  Effect: "Allow",
                  Resource: "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo",
                  Action: [
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes"
                  ]
                }
              ])
            }
          }
        });
      });
    }

    it("provisions default lambda", () => {
      expect(mockLambda).toHaveBeenNthCalledWith(
        // The queue would be deployed first, if its not then the calls should be 1 step before.
        3 + Number(expectsQueueDeployment),
        {
          description: expect.any(String),
          handler: "index.handler",
          code: path.join(fixturePath, DEFAULT_LAMBDA_CODE_DIR),
          memory: 512,
          timeout: 10,
          runtime: "nodejs12.x",
          role: {
            service: ["lambda.amazonaws.com", "edgelambda.amazonaws.com"],
            policy: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Resource: "*",
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                  ]
                },
                {
                  Effect: "Allow",
                  Resource: `arn:aws:s3:::bucket-xyz/*`,
                  Action: ["s3:GetObject", "s3:PutObject"]
                },
                ...(expectsQueueDeployment
                  ? [
                      {
                        Effect: "Allow",
                        Resource:
                          "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo",
                        Action: ["sqs:SendMessage"]
                      }
                    ]
                  : [])
              ]
            }
          }
        }
      );
    });

    it("provisions api lambda", () => {
      expect(mockLambda).toHaveBeenNthCalledWith(
        1 + Number(expectsQueueDeployment),
        {
          description: expect.any(String),
          handler: "index.handler",
          code: path.join(fixturePath, API_LAMBDA_CODE_DIR),
          memory: 512,
          timeout: 10,
          runtime: "nodejs12.x",
          role: {
            service: ["lambda.amazonaws.com", "edgelambda.amazonaws.com"],
            policy: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Resource: "*",
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                  ]
                },
                {
                  Effect: "Allow",
                  Resource: `arn:aws:s3:::bucket-xyz/*`,
                  Action: ["s3:GetObject", "s3:PutObject"]
                },
                ...(expectsQueueDeployment
                  ? [
                      {
                        Effect: "Allow",
                        Resource:
                          "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo",
                        Action: ["sqs:SendMessage"]
                      }
                    ]
                  : [])
              ]
            }
          }
        }
      );
    });

    it("provisions image lambda", () => {
      expect(mockLambda).toHaveBeenNthCalledWith(
        2 + Number(expectsQueueDeployment),
        {
          description: expect.any(String),
          handler: "index.handler",
          code: path.join(fixturePath, IMAGE_LAMBDA_CODE_DIR),
          memory: 512,
          timeout: 10,
          runtime: "nodejs12.x",
          role: {
            service: ["lambda.amazonaws.com", "edgelambda.amazonaws.com"],
            policy: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Resource: "*",
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                  ]
                },
                {
                  Effect: "Allow",
                  Resource: `arn:aws:s3:::bucket-xyz/*`,
                  Action: ["s3:GetObject", "s3:PutObject"]
                },
                ...(expectsQueueDeployment
                  ? [
                      {
                        Effect: "Allow",
                        Resource:
                          "arn:aws:sqs:us-east-1:123456789012:MyQueue.fifo",
                        Action: ["sqs:SendMessage"]
                      }
                    ]
                  : [])
              ]
            }
          }
        }
      );
    });

    it("creates distribution", () => {
      expect(mockCloudFront).toBeCalledWith({
        defaults: {
          allowedHttpMethods: expect.any(Array),
          forward: {
            queryString: true,
            cookies: "all"
          },
          minTTL: 0,
          defaultTTL: 0,
          maxTTL: 31536000,
          "lambda@edge": {
            "origin-request":
              "arn:aws:lambda:us-east-1:123456789012:function:default-cachebehavior-func:v1"
          },
          compress: true
        },
        origins: [
          {
            url: "http://bucket-xyz.s3.us-east-1.amazonaws.com",
            private: true,
            pathPatterns: {
              "_next/static/*": {
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
                    "arn:aws:lambda:us-east-1:123456789012:function:default-cachebehavior-func:v1"
                }
              },
              "static/*": {
                minTTL: 0,
                defaultTTL: 86400,
                maxTTL: 31536000,
                forward: {
                  headers: "none",
                  cookies: "none",
                  queryString: false
                }
              },
              "api/*": {
                minTTL: 0,
                defaultTTL: 0,
                maxTTL: 31536000,
                "lambda@edge": {
                  "origin-request":
                    "arn:aws:lambda:us-east-1:123456789012:function:api-cachebehavior-func:v1"
                },
                allowedHttpMethods: expect.any(Array)
              },
              "_next/image*": {
                minTTL: 0,
                defaultTTL: 60,
                maxTTL: 31536000,
                "lambda@edge": {
                  "origin-request":
                    "arn:aws:lambda:us-east-1:123456789012:function:image-cachebehavior-func:v1"
                },
                forward: {
                  headers: ["Accept"]
                },
                allowedHttpMethods: expect.any(Array)
              }
            }
          }
        ],
        distributionId: null
      });
    });

    it("invalidates distribution cache", () => {
      expect(mockCreateInvalidation).toBeCalledWith({
        credentials: {
          accessKeyId: "123",
          secretAccessKey: "456"
        },
        distributionId: "cloudfrontdistrib"
      });
    });
  });

  it("uploads static assets to S3 correctly", () => {
    expect(mockUpload).toBeCalledTimes(13);

    ["BUILD_ID"].forEach((file) => {
      expect(mockUpload).toBeCalledWith(
        expect.objectContaining({
          Key: file
        })
      );
    });

    [
      "static-pages/test-build-id/index.html",
      "static-pages/test-build-id/terms.html",
      "static-pages/test-build-id/404.html",
      "static-pages/test-build-id/about.html"
    ].forEach((file) => {
      expect(mockUpload).toBeCalledWith(
        expect.objectContaining({
          Key: file,
          CacheControl: "public, max-age=0, s-maxage=2678400, must-revalidate"
        })
      );
    });

    // Fallback page is never cached in S3
    ["static-pages/test-build-id/blog/[post].html"].forEach((file) => {
      expect(mockUpload).toBeCalledWith(
        expect.objectContaining({
          Key: file,
          CacheControl: "public, max-age=0, s-maxage=0, must-revalidate"
        })
      );
    });

    [
      "_next/static/chunks/chunk1.js",
      "_next/static/test-build-id/placeholder.js"
    ].forEach((file) => {
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
          CacheControl: "public, max-age=0, s-maxage=2678400, must-revalidate"
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
});
