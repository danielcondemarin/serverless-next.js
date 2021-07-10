module.exports = {
  render: jest.fn((req, res) => {
    res.end("pages/async-page.js");
    return new Promise(() => {});
  })
};
