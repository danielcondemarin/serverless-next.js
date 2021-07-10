export function getStaticProps() {
  return {
    props: {}
  };
}

export function getStaticPaths() {
  return { fallback: true, paths: ["/fallback/example-static-page"] };
}

export default function Page() {
  return "empty";
}
