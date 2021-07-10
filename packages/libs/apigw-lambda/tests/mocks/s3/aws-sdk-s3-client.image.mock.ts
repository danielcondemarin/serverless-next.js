import sharp from "sharp";
import { Readable } from "stream";

export const mockSend = jest.fn(async (input) => {
  const imageBuffer: Buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  if (input.Key.includes("throw-error.png")) {
    throw new Error("Mocked error");
  }

  return {
    Body: Readable.from(imageBuffer),
    ContentType: "image/png"
  };
});

const MockS3Client = jest.fn(() => ({
  constructor: () => {},
  send: mockSend
}));

export { MockS3Client as S3Client };
