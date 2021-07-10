export function getStaticProps() {
  return {
    revalidate: 5,
    props: {}
  };
}

export default function Page() {
  return "empty";
}
