module.exports = {
  render: (req, res) => {
    res.end("pages/preview.js");
  },
  renderReqToHTML: (req, res) => {
    return {
      renderOpts: {
        pageData: {
          page: "pages/preview.js"
        }
      }
    };
  }
};
