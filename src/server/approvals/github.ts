
import { Octokit } from '@octokit/rest'




export interface GithubPR {
  
  mergePR(prNumber: number): Promise<void>

  
  closePR(prNumber: number): Promise<void>
}




export function parsePrNumber(url: string | null | undefined): number | null {
  if (!url) return null
  const m = url.match(/\/pull\/(\d+)/)
  return m ? Number(m[1]) : null
}




export class OctokitGithubPR implements GithubPR {
  private readonly owner: string
  private readonly repo: string

  constructor(
    private readonly octokit: Octokit,
    
    repoSlug: string,
  ) {
    const idx = repoSlug.indexOf('/')
    if (idx === -1) throw new Error(`OctokitGithubPR: invalid repoSlug "${repoSlug}" — expected "owner/repo"`)
    this.owner = repoSlug.slice(0, idx)
    this.repo = repoSlug.slice(idx + 1)
  }

  async mergePR(prNumber: number): Promise<void> {
    try {
      await this.octokit.pulls.merge({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      })
    } catch (err) {
      
      
      if ((err as { status?: number })?.status === 405) return
      throw err
    }
  }

  async closePR(prNumber: number): Promise<void> {
    await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      state: 'closed',
    })
  }
}
