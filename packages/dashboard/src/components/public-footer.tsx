export function PublicFooter() {
  return (
    <div className="mx-auto max-w-5xl border-t border-white/[0.06] px-6 pb-12 pt-8 text-center text-xs text-zinc-500">
      <p>
        MIT licensed. Built with{' '}
        <a href="https://claude.ai/claude-code" className="text-zinc-400 underline hover:text-white transition" target="_blank" rel="noopener noreferrer">
          Claude Code
        </a>
        .{' '}
        <a href="https://github.com/smigolsmigol/llmkit" className="text-zinc-400 underline hover:text-white transition" target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </p>
    </div>
  );
}
