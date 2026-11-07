"""Workspace APIs: public share links and cascading project deletion."""
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.project_shares import Project_shares
from models.project_versions import Project_versions
from models.projects import Projects
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])


class ShareRequest(BaseModel):
    project_id: int


class ShareResponse(BaseModel):
    project_id: int
    token: Optional[str] = None


class SharedProjectResponse(BaseModel):
    title: str
    code: str
    version: int
    updated_at: Optional[str] = None


class DeleteResponse(BaseModel):
    deleted: bool


async def _owned_project(db: AsyncSession, project_id: int, user_id: str) -> Projects:
    result = await db.execute(
        select(Projects).where(Projects.id == project_id, Projects.user_id == user_id)
    )
    project = result.scalars().first()
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    return project


async def _find_share(db: AsyncSession, project_id: int, user_id: str) -> Optional[Project_shares]:
    result = await db.execute(
        select(Project_shares)
        .where(Project_shares.project_id == project_id, Project_shares.user_id == user_id)
        .order_by(Project_shares.id.desc())
        .limit(1)
    )
    return result.scalars().first()


@router.get("/share-status/{project_id}", response_model=ShareResponse)
async def share_status(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_project(db, project_id, current_user.id)
    share = await _find_share(db, project_id, current_user.id)
    return ShareResponse(project_id=project_id, token=share.token if share else None)


@router.post("/share", response_model=ShareResponse)
async def create_share(
    data: ShareRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_project(db, data.project_id, current_user.id)
    existing = await _find_share(db, data.project_id, current_user.id)
    if existing:
        return ShareResponse(project_id=data.project_id, token=existing.token)
    token = secrets.token_urlsafe(16)
    db.add(Project_shares(user_id=current_user.id, project_id=data.project_id, token=token))
    await db.commit()
    return ShareResponse(project_id=data.project_id, token=token)


@router.delete("/share/{project_id}", response_model=DeleteResponse)
async def revoke_share(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _owned_project(db, project_id, current_user.id)
    await db.execute(
        delete(Project_shares).where(
            Project_shares.project_id == project_id, Project_shares.user_id == current_user.id
        )
    )
    await db.commit()
    return DeleteResponse(deleted=True)


@router.get("/public/{token}", response_model=SharedProjectResponse)
async def get_shared_project(token: str, db: AsyncSession = Depends(get_db)):
    """Public, read-only access to a shared project's current code."""
    result = await db.execute(select(Project_shares).where(Project_shares.token == token).limit(1))
    share = result.scalars().first()
    if share is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已被停止分享")
    result = await db.execute(
        select(Projects).where(Projects.id == share.project_id, Projects.user_id == share.user_id)
    )
    project = result.scalars().first()
    if project is None or not (project.code or "").strip():
        raise HTTPException(status_code=404, detail="该项目暂无可预览的版本")
    updated = getattr(project, "updated_at", None)
    return SharedProjectResponse(
        title=project.title,
        code=project.code,
        version=project.version or 0,
        updated_at=updated.isoformat() if updated else None,
    )


@router.delete("/projects/{project_id}", response_model=DeleteResponse)
async def delete_project(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deletes a project together with its versions and share links."""
    project = await _owned_project(db, project_id, current_user.id)
    await db.execute(
        delete(Project_versions).where(
            Project_versions.project_id == project_id, Project_versions.user_id == current_user.id
        )
    )
    await db.execute(
        delete(Project_shares).where(
            Project_shares.project_id == project_id, Project_shares.user_id == current_user.id
        )
    )
    await db.delete(project)
    await db.commit()
    return DeleteResponse(deleted=True)
