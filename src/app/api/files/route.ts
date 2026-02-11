import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/ai/anthropic'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
]

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('project_id') as string | null

    if (!file || !projectId) {
      return NextResponse.json(
        { success: false, error: 'file と project_id は必須です' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'ファイルサイズは10MB以下にしてください' },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: '画像 (PNG/JPEG/GIF/WebP)、PDF、ZIP のみアップロード可能です',
        },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

    const ext = file.name.split('.').pop() ?? 'bin'
    const filePath = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('project-files')
      .upload(filePath, file, {
        contentType: file.type,
      })

    if (uploadError) {
      return NextResponse.json(
        { success: false, error: 'ファイルのアップロードに失敗しました' },
        { status: 500 }
      )
    }

    let analysisResult = null

    if (file.type.startsWith('image/')) {
      try {
        const buffer = await file.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')

        const analysis = await sendMessage(
          'あなたはファイル解析のスペシャリストです。画像の内容を詳しく説明し、プロジェクト要件に関連する情報を抽出してください。',
          [
            {
              role: 'user',
              content: `この画像を解析してください。プロジェクト要件に関連する情報を抽出してください。[画像: ${file.name}, タイプ: ${file.type}]`,
            },
          ]
        )
        analysisResult = { type: 'image', summary: analysis }
      } catch {
        analysisResult = { type: 'image', summary: '画像の解析に失敗しました' }
      }
    } else if (file.type === 'application/pdf') {
      analysisResult = {
        type: 'pdf',
        summary: 'PDF の解析は管理者側で確認してください',
      }
    }

    const { data: savedFile, error: dbError } = await supabase
      .from('project_files')
      .insert({
        project_id: projectId,
        file_path: filePath,
        file_type: file.type,
        file_name: file.name,
        file_size: file.size,
        analysis_result: analysisResult,
      })
      .select()
      .single()

    if (dbError) {
      return NextResponse.json(
        { success: false, error: 'ファイル情報の保存に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: savedFile,
    })
  } catch {
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
