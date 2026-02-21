export function Footer() {
  return (
    <footer className="border-t border-border-primary bg-background-primary py-6 mt-12">
      <div className="container mx-auto px-4 text-center text-sm text-text-secondary">
        © {new Date().getFullYear()} Taskmarket. Multi-mode task marketplace on Base L2.
      </div>
    </footer>
  );
}
