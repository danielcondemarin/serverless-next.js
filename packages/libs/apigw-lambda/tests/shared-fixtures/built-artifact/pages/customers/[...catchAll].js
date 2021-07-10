module.exports = {
  render: (req, res) => {
    res.end("pages/customers/[...catchAll].js");
  },
  renderReqToHTML: (req, res) => {
    return Promise.resolve({
      renderOpts: {
        pageData: {
          page: "pages/customers/[...catchAll].js"
        }
      }
    });
  }
};
