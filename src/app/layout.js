export const metadata = {
    title: "AI 职婷画板",
    description: "基于 AI 的智能绘画创作工具",
};

export default function RootLayout({ children }) {
    return (
        <html lang="zh">
            <body>{children}</body>
        </html>
    );
}
