module.exports = {
  render: (req, res) => {
    res.end("pages/customers/[customer]/profile.js");
  },
  renderReqToHTML: (req, res) => {
    return Promise.resolve({
      renderOpts: {
        pageData: {
          page: "pages/customers/[customer]/profile.js"
        }
      }
    });
  }
};
