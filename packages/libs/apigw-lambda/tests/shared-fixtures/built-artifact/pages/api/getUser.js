module.exports = {
  default: jest.fn((req, res) => {
    res.end("pages/api/getUser.js");
  })
};
