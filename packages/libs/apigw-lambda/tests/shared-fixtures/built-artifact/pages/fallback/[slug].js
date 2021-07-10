module.exports = {
  getStaticProps: jest.fn(),
  render: (req, res) => {
    res.end("pages/fallback/[slug].js");
  },
  renderReqToHTML: jest.fn((req, res) => {
    return Promise.resolve({
      html: "<div>Rendered Page</div>",
      renderOpts: {
        pageData: {
          page: "pages/fallback/[slug].js"
        }
      }
    });
  })
};
