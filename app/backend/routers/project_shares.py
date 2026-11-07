import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.project_shares import Project_sharesService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/project_shares", tags=["project_shares"])


# ---------- Pydantic Schemas ----------
class Project_sharesData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    token: str


class Project_sharesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    token: Optional[str] = None


class Project_sharesResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    project_id: int
    token: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Project_sharesListResponse(BaseModel):
    """List response schema"""
    items: List[Project_sharesResponse]
    total: int
    skip: int
    limit: int


class Project_sharesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Project_sharesData]


class Project_sharesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Project_sharesUpdateData


class Project_sharesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Project_sharesBatchUpdateItem]


class Project_sharesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Project_sharesListResponse)
async def query_project_sharess(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query project_sharess with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying project_sharess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Project_sharesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} project_sharess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid project_shares query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying project_sharess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Project_sharesListResponse)
async def query_project_sharess_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query project_sharess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying project_sharess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Project_sharesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} project_sharess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid project_shares query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying project_sharess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Project_sharesResponse)
async def get_project_shares(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single project_shares by ID (user can only see their own records)"""
    logger.debug(f"Fetching project_shares with id: {id}, fields={fields}")
    
    service = Project_sharesService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Project_shares with id {id} not found")
            raise HTTPException(status_code=404, detail="Project_shares not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching project_shares {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Project_sharesResponse, status_code=201)
async def create_project_shares(
    data: Project_sharesData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new project_shares"""
    logger.debug(f"Creating new project_shares with data: {data}")
    
    service = Project_sharesService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create project_shares")
        
        logger.info(f"Project_shares created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating project_shares: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating project_shares: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Project_sharesResponse], status_code=201)
async def create_project_sharess_batch(
    request: Project_sharesBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple project_sharess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} project_sharess")
    
    service = Project_sharesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} project_sharess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Project_sharesResponse])
async def update_project_sharess_batch(
    request: Project_sharesBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple project_sharess in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} project_sharess")
    
    service = Project_sharesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} project_sharess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Project_sharesResponse)
async def update_project_shares(
    id: int,
    data: Project_sharesUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing project_shares (requires ownership)"""
    logger.debug(f"Updating project_shares {id} with data: {data}")

    service = Project_sharesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Project_shares with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Project_shares not found")
        
        logger.info(f"Project_shares {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating project_shares {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating project_shares {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_project_sharess_batch(
    request: Project_sharesBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple project_sharess by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} project_sharess")
    
    service = Project_sharesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} project_sharess successfully")
        return {"message": f"Successfully deleted {deleted_count} project_sharess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_project_shares(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single project_shares by ID (requires ownership)"""
    logger.debug(f"Deleting project_shares with id: {id}")
    
    service = Project_sharesService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Project_shares with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Project_shares not found")
        
        logger.info(f"Project_shares {id} deleted successfully")
        return {"message": "Project_shares deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting project_shares {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")