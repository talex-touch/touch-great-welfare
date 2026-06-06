async function readErrorMessage(response: Response) {
  const text = await response.text()
  if (!text)
    return 'Turnstile 校验失败'

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || 'Turnstile 校验失败'
  }
  catch {
    return text
  }
}

export async function verifyTurnstileToken(userId: string, token: string) {
  const response = await fetch('/api/turnstile/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-welfare-user-id': userId,
    },
    body: JSON.stringify({ token }),
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  return response.json() as Promise<{ ok: true }>
}
