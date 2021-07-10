module.exports = {
  default: (req, res) => {
    res.setHeader("connection", "keep-alive"); // AWS Blacklisted header will be removed
    res.end("pages/api/getCustomers.js");
  }
};
