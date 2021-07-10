module.exports = {
  render: (req, res) => {
    res.setHeader("connection", "keep-alive"); // AWS Blacklisted header will be removed
    res.end("pages/customers.js");
  },
  renderReqToHTML: (req, res) => {
    return {
      renderOpts: {
        pageData: {
          page: "pages/customers.js"
        }
      }
    };
  }
};
