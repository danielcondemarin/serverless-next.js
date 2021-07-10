module.exports = {
  render: (req, res) => {
    res.end("pages/customers/[customer].js");
  },
  renderReqToHTML: (req, res) => {
    return Promise.resolve({
      renderOpts: {
        pageData: {
          page: "pages/customers/[customer].js"
        }
      }
    });
  }
};
