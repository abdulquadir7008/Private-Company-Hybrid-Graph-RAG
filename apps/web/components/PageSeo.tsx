"use client";

import { useEffect } from "react";

interface PageSeoProps {
  title?: string;
  description?: string;
  keywords?: string[];
}

export default function PageSeo({ title, description, keywords }: PageSeoProps) {
  useEffect(() => {
    if (title) document.title = `${title} | Graph RAG Assistant`;
    if (description) {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
      }
      meta.content = description;
    }
    if (keywords && keywords.length) {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "keywords";
        document.head.appendChild(meta);
      }
      meta.content = keywords.join(", ");
    }
  }, [title, description, keywords]);

  return null;
}