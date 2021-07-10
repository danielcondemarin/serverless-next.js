export function getStaticProps() {
  return {
    props: {}
  };
}

export function getStaticPaths() {
  return { fallback: false, paths: ["/no-fallback/example-static-page"] };
}

export default function Page() {
  return "empty";
}
