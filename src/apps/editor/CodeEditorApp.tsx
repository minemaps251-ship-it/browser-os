import type { ApplicationProps } from '../../app/builtInApps'
import { TextDocumentApp } from '../text-document/TextDocumentApp'
import { editorManifest } from './manifest'
export default function CodeEditorApp(props: ApplicationProps) {
  return <TextDocumentApp {...props} appId={editorManifest.id} code />
}
