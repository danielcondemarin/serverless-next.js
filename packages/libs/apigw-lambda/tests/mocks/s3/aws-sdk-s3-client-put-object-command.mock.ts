// This mock makes it easier to unit test by returning params with the command name
const MockPutObjectCommand = jest.fn((params: object) => {
  return {
    ...{
      Command: "PutObjectCommand"
    },
    ...params
  };
});

export { MockPutObjectCommand as PutObjectCommand };
