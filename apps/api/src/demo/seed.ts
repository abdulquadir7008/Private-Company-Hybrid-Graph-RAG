import type { Document, DocumentChunk } from "@prisma/client";
import type { EntityType, RelationshipType } from "@graphrag/shared";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { hashPassword } from "../auth/passwords.js";
import { slugify } from "../util/slug.js";
import { detectStructure } from "../ingestion/structure.js";
import { chunkDocument } from "../ingestion/chunk.js";
import { upsertEntity, upsertRelationship, upsertDocumentChunkProvenance, linkChunkMention } from "../graph/repository.js";
import { aclToChromaFlags } from "../access/policy.js";
import { upsertChunkVector } from "../vector/chroma.js";
import { normalizeName } from "../extraction/resolution.js";
import { embedTexts } from "../ai/llm.js";

const DEMO_COMPANY_SLUG = "acme-inc";
const DEMO_COMPANY_NAME = "Acme Inc";

interface SeedDocument {
  title: string;
  category: "HR_POLICY" | "PRODUCT" | "TECHNICAL" | "LEGAL" | "TRAINING" | "OTHER";
  content: string;
  allowedRoles: string[];
  allowedDepartments: string[];
}

const SEED_DOCUMENTS: SeedDocument[] = [
  {
    title: "Employee Handbook",
    category: "HR_POLICY",
    allowedRoles: ["ADMIN", "HR", "MANAGER", "EMPLOYEE", "LEGAL"],
    allowedDepartments: [],
    content: `# Employee Handbook

## Introduction
Welcome to Acme Inc. This handbook describes the policies and expectations for all employees.

## Remote Work Policy
Acme supports flexible remote work. Employees may work remotely up to three days per week with manager approval. The Remote Work Policy applies to all employees and contractors. Remote workers must have a reliable internet connection and adhere to the Information Security Policy.

## Employee Leave Policy
Employees are entitled to paid annual leave. The Leave Policy is managed by the HR department. Employees must request leave through their manager. Leave is approved by the HR department under the Leave Policy.

## Information Security Policy
All employees must follow the Information Security Policy. Remote work is subject to the Information Security Policy. Security incidents must be reported to the IT team.
`
  },
  {
    title: "Remote Work Policy",
    category: "HR_POLICY",
    allowedRoles: ["ADMIN", "HR", "MANAGER", "EMPLOYEE", "CONTRACTOR"],
    allowedDepartments: [],
    content: `# Remote Work Policy

## Policy Statement
This Remote Work Policy defines the terms of remote and hybrid work at Acme Inc.

## Ownership
The Remote Work Policy is owned by the Human Resources department. The HR department manages this policy. The policy was created by the HR department and is updated by the HR department.

## Applicability
The Remote Work Policy applies to all employees. The Remote Work Policy applies to all contractors. Departments affected by the Remote Work Policy include Engineering, Sales, and Legal.

## Equipment
Remote employees require approved Technology including laptops and secure VPN access. Remote work depends on the Information Security Policy. The Remote Work Policy requires reliable internet access.
`
  },
  {
    title: "Employee Leave Policy",
    category: "HR_POLICY",
    allowedRoles: ["ADMIN", "HR", "MANAGER", "EMPLOYEE"],
    allowedDepartments: [],
    content: `# Leave Policy

## Policy Statement
The Leave Policy defines paid and unpaid leave for employees.

## Ownership
The Leave Policy is owned by the HR department. HR manages all leave requests. The HR Manager responsible for the Leave Policy is John Smith.

## Procedure
Employees must submit leave requests to their manager. Leave requests are approved by the HR department. The Leave Policy requires advance notice of at least two weeks for scheduled leave.

## Relationships with Other Policies
The Leave Policy is related to the Remote Work Policy. The Leave Policy affects employees in all departments.
`
  },
  {
    title: "Information Security Policy",
    category: "TECHNICAL",
    allowedRoles: ["ADMIN", "HR", "LEGAL", "MANAGER", "EMPLOYEE", "CONTRACTOR"],
    allowedDepartments: [],
    content: `# Information Security Policy

## Policy Statement
The Information Security Policy protects Acme company data and systems.

## Applicability
The Information Security Policy applies to all employees and contractors. The Information Security Policy applies to the Engineering department, HR department, and Legal department.

## Products
The security policy affects the Project Atlas product. The security policy affects the Data Warehouse project. The Project Atlas product depends on the security policy.

## Technology
The security policy defines requirements for approved Technology including VPN, multi-factor authentication, and endpoint encryption. The Project Atlas product uses the approved technology stack.
`
  },
  {
    title: "Product Architecture Guide",
    category: "PRODUCT",
    allowedRoles: ["ADMIN", "MANAGER", "EMPLOYEE", "CONTRACTOR"],
    allowedDepartments: ["ENGINEERING"],
    content: `# Product Architecture Guide

## Project Atlas
Project Atlas is Acme's flagship product. Project Atlas is developed by the Engineering department.

## Architecture
Project Atlas uses a microservices architecture. The Project Atlas architecture depends on the Authentication Service and the Data Warehouse project.

## Technology Stack
Project Atlas uses the following technology: React, Node.js, PostgreSQL, and Kubernetes.

## Security
The Project Atlas product is affected by the Information Security Policy. Engineering must follow the security requirements defined in the Information Security Policy.
`
  },
  {
    title: "Engineering Onboarding Guide",
    category: "TRAINING",
    allowedRoles: ["ADMIN", "MANAGER", "EMPLOYEE", "CONTRACTOR"],
    allowedDepartments: ["ENGINEERING"],
    content: `# Engineering Onboarding Guide

## Getting Started
This guide helps new engineers join the Engineering department at Acme.

## Responsibilities
Engineers report to the Engineering Manager. The Engineering Manager manages the Engineering team. Engineers belong to the Engineering department.

## Related Documentation
New engineers must read the Employee Handbook and the Information Security Policy. The Engineering Onboarding Guide is related to the Information Security Policy. The Engineering Onboarding Guide depends on the Product Architecture Guide.

## Technology
Engineers use the approved Technology stack listed in the Product Architecture Guide. The onboarding guide requires access to the Project Atlas repository.
`
  },
  {
    title: "Legal Contract Guidelines",
    category: "LEGAL",
    allowedRoles: ["ADMIN", "LEGAL", "MANAGER"],
    allowedDepartments: [],
    content: `# Legal Contract Guidelines

## Purpose
These guidelines cover contract review and approval at Acme.

## Ownership
The Legal department owns these contract guidelines. The Legal department manages contract review. Contractors are subject to the Legal Contract Guidelines.

## Scope
The Legal Contract Guidelines apply to contractors, the Legal department, and the Sales department. All product contracts for Project Atlas are reviewed under these guidelines.
`
  }
];

interface SeedRel {
  source: string;
  type: RelationshipType;
  target: string;
  confidence: number;
  sourceDoc: string;
}

/** Curated, high-quality demo graph that satisfies the required example questions. */
const SEED_RELATIONSHIPS: SeedRel[] = [
  { source: "John Smith", type: "WORKS_FOR", target: "Acme Inc", confidence: 0.99, sourceDoc: "Employee Handbook" },
  { source: "Jane Chen", type: "WORKS_FOR", target: "Acme Inc", confidence: 0.99, sourceDoc: "Employee Handbook" },
  { source: "John Smith", type: "BELONGS_TO", target: "HR Department", confidence: 0.97, sourceDoc: "Employee Handbook" },
  { source: "John Smith", type: "HAS_ROLE", target: "HR Manager", confidence: 0.98, sourceDoc: "Employee Leave Policy" },
  { source: "John Smith", type: "MANAGES", target: "HR Department", confidence: 0.96, sourceDoc: "Employee Handbook" },
  { source: "Jane Chen", type: "BELONGS_TO", target: "Engineering Department", confidence: 0.97, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Jane Chen", type: "HAS_ROLE", target: "Engineering Manager", confidence: 0.98, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Jane Chen", type: "MANAGES", target: "Engineering Department", confidence: 0.96, sourceDoc: "Engineering Onboarding Guide" },
  { source: "HR Department", type: "OWNS", target: "Remote Work Policy", confidence: 0.99, sourceDoc: "Remote Work Policy" },
  { source: "HR Department", type: "MANAGES", target: "Remote Work Policy", confidence: 0.98, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "APPLIES_TO", target: "Employee", confidence: 0.99, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "APPLIES_TO", target: "Contractor", confidence: 0.95, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "AFFECTS", target: "Engineering Department", confidence: 0.9, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "AFFECTS", target: "Sales Department", confidence: 0.9, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "AFFECTS", target: "Legal Department", confidence: 0.9, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "DEPENDS_ON", target: "Information Security Policy", confidence: 0.93, sourceDoc: "Remote Work Policy" },
  { source: "Remote Work Policy", type: "RELATED_TO", target: "Employee Leave Policy", confidence: 0.85, sourceDoc: "Remote Work Policy" },
  { source: "HR Department", type: "OWNS", target: "Employee Leave Policy", confidence: 0.99, sourceDoc: "Employee Leave Policy" },
  { source: "HR Department", type: "OWNS", target: "Leave Policy", confidence: 0.99, sourceDoc: "Employee Leave Policy" },
  { source: "Leave Policy", type: "RELATED_TO", target: "Remote Work Policy", confidence: 0.86, sourceDoc: "Employee Leave Policy" },
  { source: "Leave Policy", type: "AFFECTS", target: "Employee", confidence: 0.92, sourceDoc: "Employee Leave Policy" },
  { source: "Employee Handbook", type: "RELATED_TO", target: "Information Security Policy", confidence: 0.8, sourceDoc: "Employee Handbook" },
  { source: "Information Security Policy", type: "APPLIES_TO", target: "Employee", confidence: 0.99, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "APPLIES_TO", target: "Contractor", confidence: 0.98, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "AFFECTS", target: "Project Atlas", confidence: 0.95, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "APPLIES_TO", target: "Engineering Department", confidence: 0.94, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "APPLIES_TO", target: "HR Department", confidence: 0.94, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "APPLIES_TO", target: "Legal Department", confidence: 0.94, sourceDoc: "Information Security Policy" },
  { source: "Information Security Policy", type: "RELATED_TO", target: "Remote Work Policy", confidence: 0.9, sourceDoc: "Information Security Policy" },
  { source: "Project Atlas", type: "DEPENDS_ON", target: "Information Security Policy", confidence: 0.88, sourceDoc: "Information Security Policy" },
  { source: "Project Atlas", type: "BELONGS_TO", target: "Engineering Department", confidence: 0.95, sourceDoc: "Product Architecture Guide" },
  { source: "Project Atlas", type: "USED_BY", target: "Kubernetes", confidence: 0.9, sourceDoc: "Product Architecture Guide" },
  { source: "Project Atlas", type: "USED_BY", target: "PostgreSQL", confidence: 0.9, sourceDoc: "Product Architecture Guide" },
  { source: "Project Atlas", type: "USED_BY", target: "React", confidence: 0.9, sourceDoc: "Product Architecture Guide" },
  { source: "Engineering Department", type: "OWNS", target: "Engineering Onboarding Guide", confidence: 0.97, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Engineering Department", type: "OWNS", target: "Product Architecture Guide", confidence: 0.96, sourceDoc: "Product Architecture Guide" },
  { source: "Engineering Onboarding Guide", type: "BELONGS_TO", target: "Engineering Department", confidence: 0.97, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Engineering Onboarding Guide", type: "RELATED_TO", target: "Information Security Policy", confidence: 0.9, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Engineering Onboarding Guide", type: "DEPENDS_ON", target: "Product Architecture Guide", confidence: 0.88, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Engineering Onboarding Guide", type: "RELATED_TO", target: "Employee Handbook", confidence: 0.8, sourceDoc: "Engineering Onboarding Guide" },
  { source: "Legal Department", type: "OWNS", target: "Legal Contract Guidelines", confidence: 0.98, sourceDoc: "Legal Contract Guidelines" },
  { source: "Legal Contract Guidelines", type: "APPLIES_TO", target: "Contractor", confidence: 0.95, sourceDoc: "Legal Contract Guidelines" },
  { source: "Engineering Manager", type: "MANAGES", target: "Engineering Department", confidence: 0.97, sourceDoc: "Engineering Onboarding Guide" },
];

const SEED_ENTITIES: { name: string; type: EntityType; description: string }[] = [
  { name: "Acme Inc", type: "Company", description: "Demo company" },
  { name: "John Smith", type: "Person", description: "HR Manager at Acme Inc" },
  { name: "Jane Chen", type: "Person", description: "Engineering Manager at Acme Inc" },
  { name: "Employee", type: "Role", description: "Full-time employee role" },
  { name: "Contractor", type: "Role", description: "Contract worker role" },
  { name: "HR Manager", type: "Role", description: "Manages the HR department" },
  { name: "Engineering Manager", type: "Role", description: "Manages the Engineering department" },
  { name: "HR Department", type: "Department", description: "Human Resources department" },
  { name: "Engineering Department", type: "Department", description: "Engineering department" },
  { name: "Legal Department", type: "Department", description: "Legal department" },
  { name: "Sales Department", type: "Department", description: "Sales department" },
  { name: "Remote Work Policy", type: "Policy", description: "Defines remote and hybrid work terms" },
  { name: "Employee Leave Policy", type: "Policy", description: "Defines paid and unpaid leave" },
  { name: "Leave Policy", type: "Policy", description: "Defines leave entitlements and procedure" },
  { name: "Information Security Policy", type: "Policy", description: "Protects company data and systems" },
  { name: "Product Architecture Guide", type: "Document", description: "Describes Project Atlas architecture" },
  { name: "Engineering Onboarding Guide", type: "Document", description: "Onboarding guide for new engineers" },
  { name: "Employee Handbook", type: "Document", description: "Company-wide handbook" },
  { name: "Legal Contract Guidelines", type: "Document", description: "Contract review guidelines" },
  { name: "Project Atlas", type: "Product", description: "Acme flagship product" },
  { name: "Data Warehouse", type: "Project", description: "Internal data warehouse project" },
  { name: "Kubernetes", type: "Technology", description: "Container orchestration platform" },
  { name: "PostgreSQL", type: "Technology", description: "Relational database" },
  { name: "React", type: "Technology", description: "Frontend framework" },
  { name: "VPN", type: "Technology", description: "Secure remote access" }
];

/**
 * Idempotent demo seed. Builds a verified graph directly (no LLM needed), so
 * the example questions work without any AI API keys. Uploads of new real
 * documents flow through the full extraction pipeline instead.
 */
export async function seedDemoCompany(): Promise<boolean> {
  const existing = await prisma.company.findUnique({ where: { slug: DEMO_COMPANY_SLUG } });
  if (existing) {
    logger.info("demo company already seeded, skipping");
    return false;
  }

  const company = await prisma.company.create({
    data: { name: DEMO_COMPANY_NAME, slug: DEMO_COMPANY_SLUG, status: "ACTIVE" }
  });
  const companyId = company.id;

  const users = [
    { email: "admin@acme.com", name: "Acme Admin", roles: ["ADMIN"], dept: "GENERAL" as const },
    { email: "hr@acme.com", name: "John Smith", roles: ["HR", "MANAGER"], dept: "HR" as const },
    { email: "eng@acme.com", name: "Jane Chen", roles: ["MANAGER", "EMPLOYEE"], dept: "ENGINEERING" as const },
    { email: "legal@acme.com", name: "Legal Counsel", roles: ["LEGAL"], dept: "LEGAL" as const },
    { email: "employee@acme.com", name: "Alex Doe", roles: ["EMPLOYEE"], dept: "ENGINEERING" as const },
    { email: "contractor@acme.com", name: "Pat Contractor", roles: ["CONTRACTOR"], dept: "GENERAL" as const }
  ];
  for (const u of users) {
    await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        passwordHash: await hashPassword("DemoPassword123!"),
        companyId,
        department: u.dept,
        emailVerifiedAt: new Date(),
        roles: { create: u.roles.map((role) => ({ role: role as never, companyId })) }
      }
    });
  }

  const docs: Document[] = [];
  for (const sd of SEED_DOCUMENTS) {
    const doc = await prisma.document.create({
      data: {
        companyId,
        title: sd.title,
        originalName: `${slugify(sd.title)}.md`,
        mimeType: "text/markdown",
        sizeBytes: sd.content.length,
        storagePath: `demo-${slugify(sd.title)}.md`,
        category: sd.category,
        status: "INDEXED",
        ingestedAt: new Date(),
        acl: {
          create: {
            companyId,
            allowedRoles: sd.allowedRoles as never,
            allowedDepartments: sd.allowedDepartments as never,
            sensitivity: "INTERNAL"
          }
        }
      }
    });
    docs.push(doc);

    // Files don't exist on disk for the demo; seed chunks + provenance in-PG.
    const { sections, pages } = detectStructure(sd.content);
    const chunks = chunkDocument(sd.content, sections, pages);
    const docAcl = { allowedRoles: sd.allowedRoles, allowedDepartments: sd.allowedDepartments, ownerId: null };
    const flags = aclToChromaFlags(docAcl);
    let pgChunks: DocumentChunk[] = [];
    for (const c of chunks) {
      const cRow = await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          companyId,
          index: c.index,
          content: c.content,
          tokenCount: c.tokenCount,
          section: c.section ?? null,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          embeddingVersion: "demo"
        }
      });
      pgChunks.push(cRow);
      await upsertDocumentChunkProvenance({
        tenantId: companyId,
        pgDocumentId: doc.id,
        title: doc.title,
        pgChunkId: cRow.id,
        chunkIndex: c.index,
        section: c.section,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        text: c.content
      });
    }
    await prisma.document.update({
      where: { id: doc.id },
      data: { chunkCount: pgChunks.length, pageCount: pages.length }
    });
  }

  // Embed demo chunks (fallback: empty vector array so the demo works without keys).
  let embeddingsByDoc: (number[] | undefined)[][] = [];
  try {
    for (const doc of docs) {
      const chunks = await prisma.documentChunk.findMany({ where: { documentId: doc.id }, orderBy: { index: "asc" } });
      const em = await embedTexts(chunks.map((c) => c.content));
      embeddingsByDoc.push(em);
    }
  } catch {
    embeddingsByDoc = docs.map(() => []);
  }

  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    const ems = embeddingsByDoc[di] ?? [];
    const chunks = await prisma.documentChunk.findMany({ where: { documentId: doc.id }, orderBy: { index: "asc" } });
    const sd = SEED_DOCUMENTS.find((d) => d.title === doc.title)!;
    const flags = aclToChromaFlags({ allowedRoles: sd.allowedRoles, allowedDepartments: sd.allowedDepartments, ownerId: null });
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      await upsertChunkVector({
        chromaId: chunk.id,
        embedding: ems[ci],
        content: chunk.content,
        metadata: {
          documentId: doc.id,
          companyId,
          chunk_index: chunk.index,
          section: chunk.section,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          title: doc.title,
          content_preview: chunk.content.slice(0, 200),
          ...flags
        } as never
      });
    }
  }

  // Build the curated graph with provenance.
  const docByName = new Map(docs.map((d) => [d.title, d]));

  for (const ent of SEED_ENTITIES) {
    const relDoc = SEED_RELATIONSHIPS.find((r) => r.source === ent.name || r.target === ent.name)?.sourceDoc;
    const primaryDoc = docByName.get(relDoc ?? SEED_DOCUMENTS[0].title);
    if (!primaryDoc) continue;
    const chunk = await prisma.documentChunk.findFirst({ where: { documentId: primaryDoc.id }, orderBy: { index: "asc" } });
    if (!chunk) continue;
    const normalized = normalizeName(ent.name, ent.type);
    await upsertEntity({
      tenantId: companyId,
      name: ent.name,
      normalizedName: normalized,
      type: ent.type,
      description: ent.description,
      confidence: 0.95,
      documentId: primaryDoc.id,
      chunkId: chunk.id,
      section: chunk.section,
      sourceText: ent.description
    });
    await linkChunkMention({ tenantId: companyId, pgChunkId: chunk.id, entityName: ent.name, confidence: 0.95, sourceText: ent.description });
    await prisma.documentEntity.create({
      data: {
        companyId,
        documentId: primaryDoc.id,
        chunkId: chunk.id,
        name: ent.name,
        type: ent.type,
        description: ent.description,
        confidence: 0.95,
        resolved: true
      }
    });
  }

  for (const rel of SEED_RELATIONSHIPS) {
    const doc = docByName.get(rel.sourceDoc);
    if (!doc) continue;
    const chunk = await prisma.documentChunk.findFirst({ where: { documentId: doc.id }, orderBy: { index: "asc" } });
    if (!chunk) continue;
    const srcEnt = SEED_ENTITIES.find((e) => e.name === rel.source);
    const tgtEnt = SEED_ENTITIES.find((e) => e.name === rel.target);
    if (!srcEnt || !tgtEnt) continue;
    try {
      await upsertRelationship({
        tenantId: companyId,
        sourceName: rel.source,
        sourceType: srcEnt.type,
        targetName: rel.target,
        targetType: tgtEnt.type,
        type: rel.type,
        confidence: rel.confidence,
        documentId: doc.id,
        chunkId: chunk.id,
        section: chunk.section,
        sourceText: rel.source
      });
    } catch (err) {
      logger.warn("demo relationship skipped", { err, meta: { source: rel.source, type: rel.type, target: rel.target } });
    }
  }

  await prisma.suggestedQuestion.createMany({
    data: [
      { companyId, question: "What is the remote work policy?", rank: 1 },
      { companyId, question: "Who owns the remote work policy?", rank: 2 },
      { companyId, question: "Which department owns the leave policy?", rank: 3 },
      { companyId, question: "Which policies apply to contractors?", rank: 4 },
      { companyId, question: "Which documents are related to information security?", rank: 5 },
      { companyId, question: "Explain the relationship between the engineering onboarding guide and the security policy.", rank: 6 },
      { companyId, question: "What is the chain of responsibility for the remote work policy?", rank: 7 }
    ]
  });

  await prisma.graphStats.create({
    data: { companyId, entityCount: SEED_ENTITIES.length, relationshipCount: SEED_RELATIONSHIPS.length, documentCount: docs.length, orphanCount: 0, duplicateEntityCount: 0, avgConfidence: 0.94, failedExtractionCount: 0 }
  });

  logger.info("demo company seeded", { meta: { companyId, documents: docs.length } });
  return true;
}