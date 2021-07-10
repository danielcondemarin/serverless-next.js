import { Readable } from "stream";

let fail = 0;

export const mockSend = jest.fn(async (input) => {
  if (fail > 0) {
    fail -= 1;
    throw Error("Fail");
  }

  if (input.Command === "GetObjectCommand") {
    // Simulate headers
    const contentType = input.Key.endsWith(".html")
      ? "text/html"
      : "application/json";
    const cacheControl = "public, max-age=0, s-maxage=2678400, must-revalidate";

    return {
      Body: Readable.from(["S3Body"]),
      CacheControl: cacheControl,
      ContentType: contentType
    };
  } else {
    return {};
  }
});

const MockS3Client = jest.fn(() => {
  let config = {};
  return {
    config,
    constructor: (c: any) => {
      config = { ...config, ...c };
    },
    fail: (n: number) => {
      fail = n;
    },
    send: mockSend
  };
});

export { MockS3Client as S3Client };
