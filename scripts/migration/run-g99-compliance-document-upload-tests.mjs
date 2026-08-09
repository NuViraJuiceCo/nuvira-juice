#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = relativePath => fs.readFileSync(`${root}/${relativePath}`, 'utf8');
const helper = await import(pathToFileURL(`${root}/src/lib/compliance-document-file.js`));

const pdf = { name: 'permit.pdf', type: 'application/pdf', size: 1024 };
const image = { name: 'license.heic', type: 'image/heic', size: 2048 };
assert.equal(helper.validateComplianceDocumentFile(pdf), '');
assert.equal(helper.validateComplianceDocumentFile(image), '');
assert.match(helper.validateComplianceDocumentFile(null), /Select a PDF or image/);
assert.match(helper.validateComplianceDocumentFile({ type: 'application/pdf', size: 0 }), /empty/);
assert.match(helper.validateComplianceDocumentFile({ type: 'application/pdf', size: helper.MAX_COMPLIANCE_DOCUMENT_BYTES + 1 }), /20 MB/);
assert.match(helper.validateComplianceDocumentFile({ type: 'application\/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1024 }), /PDF or image/);

const component = read('src/components/compliance/ComplianceDocumentsTab.jsx');
const uploadIndex = component.indexOf('base44.integrations.Core.UploadFile({ file: selectedFile })');
const saveIndex = component.indexOf("base44.functions.invoke('saveAdminComplianceRecord'");
assert.ok(uploadIndex > 0, 'compliance upload must use the existing Base44 file service');
assert.ok(saveIndex > uploadIndex, 'the document must upload before its metadata is saved');
assert.match(component, /accept="application\/pdf,image\/\*"/);
assert.match(component, /file_url: fileUrl/);
assert.match(component, /No compliance record was changed/);
assert.match(component, /Uploads securely when you save this record/);
assert.doesNotMatch(component, /entities\.ComplianceDoc\.(create|update|delete)/);
assert.doesNotMatch(component, /\.delete\(/);

console.log(JSON.stringify({
  success: true,
  suite: 'g99-compliance-document-upload',
  cases: 13,
  production_writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
