import { getStaticRegenerationResponse } from "../src/revalidate";

describe("revalidate", () => {
  describe("getStaticRegenerationResponse()", () => {
    it("should return a cache header at the amount defined as the initialRevalidateSeconds relative to the lastModified when no expires is passed", async () => {
      const date = new Date();
      const staticRegeneratedResponse = getStaticRegenerationResponse({
        lastModified: date,
        initialRevalidateSeconds: 10
      });

      if (!staticRegeneratedResponse) {
        throw new Error("Expected staticRegeneratedResponse to be truthy");
      }

      expect(staticRegeneratedResponse.cacheControl).toBe(
        `public, max-age=0, s-maxage=10, must-revalidate`
      );
    });

    it("should return a cache header at for the time relative to now and the expires header", async () => {
      const date = new Date(Date.now() + 5000);
      const staticRegeneratedResponse = getStaticRegenerationResponse({
        expires: date
      });

      if (!staticRegeneratedResponse) {
        throw new Error("Expected staticRegeneratedResponse to be truthy");
      }

      expect(staticRegeneratedResponse.cacheControl).toBe(
        `public, max-age=0, s-maxage=5, must-revalidate`
      );
    });

    it("should prioritise using the expires header if both expires header and last modified are present", async () => {
      const lastModified = new Date();
      const expires = new Date(Date.now() + 2000);
      const staticRegeneratedResponse = getStaticRegenerationResponse({
        expires,
        lastModified
      });

      if (!staticRegeneratedResponse) {
        throw new Error("Expected staticRegeneratedResponse to be truthy");
      }

      expect(staticRegeneratedResponse.cacheControl).toBe(
        `public, max-age=0, s-maxage=2, must-revalidate`
      );
    });

    it("should return false when no headers are passed", async () => {
      const staticRegeneratedResponse = getStaticRegenerationResponse({});

      expect(staticRegeneratedResponse).toBe(false);
    });

    it("should return false when no expires header is passed, and there is no initial validation seconds", async () => {
      const staticRegeneratedResponse = getStaticRegenerationResponse({
        lastModified: new Date()
      });

      expect(staticRegeneratedResponse).toBe(false);
    });
  });
});
