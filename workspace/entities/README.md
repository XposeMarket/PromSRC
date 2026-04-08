# Entity Graph — README
# This folder contains relational knowledge for your business.
# Each entity gets its own markdown file with structured sections.
# Files are loaded on-demand when relevant entities are detected in conversation.
#
# Structure:
#   entities/clients/       — one file per client  (e.g. acme-corp.md)
#   entities/projects/      — one file per project  (e.g. website-redesign.md)
#   entities/vendors/       — one file per vendor   (e.g. aws.md)
#   entities/contacts/      — one file per contact  (e.g. john-smith.md)
#   entities/social/        — one file per platform (e.g. instagram.md)
#
# File naming: lowercase, hyphenated  (e.g. acme-corp.md, john-smith.md)
# See _template.md in each subfolder for the correct structure.
#
# These files are written by:
#   - Conversation learning (auto-extracted after sessions)
#   - Integration sync (CRM, email, social pulls)
#   - Manual input or agent runs via write_entity()
