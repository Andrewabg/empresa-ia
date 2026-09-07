import { SupabaseClient } from '@supabase/supabase-js'
import { BrainRepo, Diff } from './repo'
import { Embedder } from './embeddings'
import { Note } from './note'
import { chunkMarkdown } from './chunk'
import { edgesOf } from './edges'


function check(res: { error: { message: string } | null }, ctx: string) {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`)
}

export class Sync {
  constructor(private db: SupabaseClient, private repo: BrainRepo, private embedder: Embedder) {}

  private async upsertNote(note: Note) {
    check(await this.db.from('notes').upsert({
      id: note.id, path: note.path, title: note.title ?? null, type: note.type,
      tags: note.tags, confidence: note.confidence, updated: new Date().toISOString(),
    }), `upsert note ${note.id}`)
    check(await this.db.from('note_chunks').delete().eq('note_id', note.id), `del chunks ${note.id}`)
    
    const indexed = note.title ? `# ${note.title}\n\n${note.body}` : note.body
    const chunks = chunkMarkdown(indexed)
    const vecs = await this.embedder.embedAll(chunks)
    check(await this.db.from('note_chunks').insert(
      chunks.map((content, i) => ({ note_id: note.id, chunk_index: i, content, embedding: '[' + vecs[i].join(',') + ']' })),
    ), `insert chunks ${note.id}`)
    check(await this.db.from('edges').delete().eq('from_id', note.id), `del edges ${note.id}`)
    const e = edgesOf(note)
    if (e.length) check(await this.db.from('edges').insert(e), `insert edges ${note.id}`)
  }

  private async removeNoteByPath(path: string) {
    const { data, error } = await this.db.from('notes').select('id').eq('path', path).maybeSingle()
    if (error) throw new Error(`find note ${path}: ${error.message}`)
    if (data) {
      check(await this.db.from('edges').delete().eq('from_id', data.id), `del edges ${data.id}`)
      check(await this.db.from('notes').delete().eq('id', data.id), `del note ${data.id}`)
    }
  }

  
  private async pruneStale(keepIds: string[]) {
    if (keepIds.length === 0) {
      check(await this.db.from('edges').delete().gte('id', 0), 'prune edges (all)')
      check(await this.db.from('notes').delete().neq('id', ''), 'prune notes (all)')
      return
    }
    const list = '(' + keepIds.map(id => JSON.stringify(id)).join(',') + ')'
    check(await this.db.from('edges').delete().not('from_id', 'in', list), 'prune edges')
    check(await this.db.from('notes').delete().not('id', 'in', list), 'prune notes')
  }

  private async setSha(sha: string) {
    check(await this.db.from('sync_state').update({
      last_synced_sha: sha, embedding_version: this.embedder.version(), updated_at: new Date().toISOString(),
    }).eq('id', 1), 'setSha')
  }

  async syncFull() {
    const notes = await this.repo.listNotes()
    for (const note of notes) await this.upsertNote(note)
    await this.pruneStale(notes.map(n => n.id))
    await this.setSha(await this.repo.headSha())
  }

  
  async syncIncremental(diff: Diff, toSha: string) {
    for (const p of [...diff.added, ...diff.modified]) await this.upsertNote(this.repo.readNote(p))
    for (const p of diff.removed) await this.removeNoteByPath(p)
    await this.setSha(toSha)
  }
}
