import type { ApplicationProps } from '../../app/builtInApps'
import { TextDocumentApp } from '../text-document/TextDocumentApp'
import { notesManifest } from './manifest'
export default function NotesApp(props: ApplicationProps) {
  return <TextDocumentApp {...props} appId={notesManifest.id} />
}
