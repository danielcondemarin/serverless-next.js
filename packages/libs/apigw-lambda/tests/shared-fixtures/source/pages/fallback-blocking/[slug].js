export function getStaticProps() {
  return {
    props: {}
  };
}

export function getStaticPaths() {
  return { fallback: "blocking", paths: [] };
}

export default function Page() {
  return "empty";
}
