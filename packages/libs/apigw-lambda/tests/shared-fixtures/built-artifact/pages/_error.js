module.exports = {
  render: (req, res) => {
    // We add status code in the body of _error.js for test purposes since
    // the Next.js default _error.js page shows different text based on the status
    // that is used when rendering the page.
    res.end(`pages/_error.js - ${res.statusCode}`);
  },
  renderReqToHTML: (req, res) => {
    return {
      renderOpts: {
        pageData: {
          page: `pages/_error.js - ${res.statusCode}`
        }
      }
    };
  }
};
