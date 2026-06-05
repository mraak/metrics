'use client'

export default function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1 cursor-help">
      <span className="text-[#6b7280] hover:text-[#3b5bdb] text-xs leading-none">ⓘ</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-64 rounded bg-[#1a2030] text-white text-xs px-2.5 py-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1a2030]" />
      </span>
    </span>
  )
}
